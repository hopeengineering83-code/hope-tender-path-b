// Same inputs, same plan — whatever order the rows arrive in.
//
// After the 2026-10-08 Pharo defect (a file's document type followed the
// first requirement read) the database reads were given one order, but the
// planner itself still took identity from array position: a file's
// canonicalId was "req-<id of the first row that named it>" and its
// sourceRequirementIds listed rows in arrival order. Shuffled 80 ways, a
// four-file tender produced 73 different plans and a one-file EOI 80. The
// plan builder now puts requirements in one canonical order (extraction time,
// then id) before it reads them.
//
// This shuffles requirements for several tender shapes and pins every field
// of the plan, the Build Plan hash, and the package manifest's file order.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildSubmissionPlan, buildSubmissionPlanWithDerivedFallback, canonicalRequirementOrder, plannedSubmissionTargetFiles } from "../lib/engine/submission-plan";
import { computeBuildPlanHash } from "../lib/engine/build-plan-hash";

function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const T0 = Date.UTC(2026, 9, 8, 12, 0, 0);
let tick = 0;
const R = (id: string, title: string, requirementType: string, extra: Partial<{ description: string; priority: string; exactFileName: string; exactOrder: number; pageLimit: number; sameTime: boolean }> = {}) => ({
  id, title, description: extra.description ?? `${title}.`, requirementType, priority: extra.priority ?? "MANDATORY",
  exactFileName: extra.exactFileName ?? null, exactOrder: extra.exactOrder ?? null, pageLimit: extra.pageLimit ?? null,
  restrictions: null, sectionReference: null, requiredQuantity: null,
  // Two rows share an extraction instant, as a batched insert produces.
  createdAt: new Date(T0 + (extra.sameTime ? tick : (tick += 1000))),
});

const TENDERS = {
  "four named files, a financial envelope and a form": {
    id: "a", title: "Design of a District Hospital",
    exactFileNaming: JSON.stringify(["Technical Proposal.pdf", "Financial Proposal.pdf", "Form TECH-1 Letter of Submission.docx", "CVs.pdf"]),
    exactFileOrder: JSON.stringify(["Form TECH-1 Letter of Submission.docx", "Technical Proposal.pdf", "CVs.pdf", "Financial Proposal.pdf"]),
    requirements: [
      R("r1", "Letter of submission", "FORM", { exactFileName: "Form TECH-1 Letter of Submission.docx" }),
      R("r2", "Approach and methodology", "METHODOLOGY", { exactFileName: "Technical Proposal.pdf" }),
      R("r3", "Work plan", "TECHNICAL", { exactFileName: "Technical Proposal.pdf", sameTime: true }),
      R("r4", "Key experts CVs", "EXPERT", { exactFileName: "CVs.pdf" }),
      R("r5", "Financial proposal", "FINANCIAL", { exactFileName: "Financial Proposal.pdf", description: "The Financial Proposal shall be submitted in a separate envelope." }),
      R("r6", "Similar assignments", "PROJECT_EXPERIENCE", { exactFileName: "Technical Proposal.pdf" }),
      R("r7", "Company registration", "ELIGIBILITY"),
      R("r8", "Tax clearance certificate", "ELIGIBILITY", { sameTime: true }),
      R("r9", "Technical proposal page limit", "FORMAT", { exactFileName: "Technical Proposal.pdf", pageLimit: 30 }),
    ],
  },
  "no named files: technical and financial proposals, a form": {
    id: "b", title: "Supervision of Road Works", exactFileNaming: null, exactFileOrder: null,
    requirements: [
      R("s1", "Technical proposal", "TECHNICAL", { description: "Submit a technical proposal." }),
      R("s2", "Financial proposal", "FINANCIAL", { description: "Submit a financial proposal in a separate envelope." }),
      R("s3", "Expression of interest letter", "FORM"),
      R("s4", "CVs of key staff", "EXPERT"),
      R("s5", "Trade licence", "ELIGIBILITY"),
      R("s6", "Experience in road supervision", "PROJECT_EXPERIENCE", { priority: "SCORED" }),
      R("s7", "Methodology", "METHODOLOGY"),
    ],
  },
  "one combined EOI file": {
    id: "c", title: "Expression of Interest for Urban Planning", exactFileNaming: JSON.stringify(["EOI Submission.pdf"]), exactFileOrder: null,
    requirements: ["COMPANY_PROFILE", "PROJECT_EXPERIENCE", "EXPERT", "ELIGIBILITY", "DECLARATION", "TECHNICAL"]
      .map((type, i) => R(`c${i}`, `${type.toLowerCase().replace(/_/g, " ")} item`, type, { exactFileName: "EOI Submission.pdf", sameTime: i % 2 === 1 })),
  },
};

describe("a plan is the same in any read order", () => {
  for (const [name, tender] of Object.entries(TENDERS)) {
    for (const build of [buildSubmissionPlan, buildSubmissionPlanWithDerivedFallback]) {
      it(`${name} — ${build.name}: every field of every file, 80 orders`, () => {
        const reference = JSON.stringify(build(tender as never));
        for (let seed = 1; seed <= 80; seed++) {
          const plan = JSON.stringify(build({ ...tender, requirements: shuffled(tender.requirements, seed) } as never));
          assert.equal(plan, reference, `read order ${seed} changed the plan`);
        }
      });
    }

    it(`${name}: the Build Plan hash does not depend on order`, () => {
      const items = plannedSubmissionTargetFiles(buildSubmissionPlan(tender as never));
      const files = [{ id: "f1", fileName: "tor.pdf", extractedText: "x" }, { id: "f2", fileName: "annex.pdf", extractedText: "y" }];
      const hash = (seed: number) => computeBuildPlanHash({
        activeFiles: shuffled(files, seed),
        requirements: shuffled(tender.requirements, seed),
        items: shuffled(items, seed),
        exactFileNaming: tender.exactFileNaming,
        exactFileOrder: tender.exactFileOrder,
        metadataOverrides: shuffled([{ field: "clientName", fieldState: "CONFIRMED", overrideValue: "A" }, { field: "deadline", fieldState: "CONFIRMED", overrideValue: "B" }], seed),
      });
      const reference = hash(0);
      for (let seed = 1; seed <= 40; seed++) assert.equal(hash(seed), reference, `order ${seed} changed the hash`);
    });
  }

  it("canonical order is extraction time, then id — the order every database read uses", () => {
    const rows = [
      { id: "b", createdAt: new Date(2000) }, { id: "a", createdAt: new Date(2000) }, { id: "c", createdAt: new Date(1000) }, { id: "d", createdAt: null },
    ];
    assert.deepEqual(canonicalRequirementOrder(rows).map((r) => r.id), ["c", "a", "b", "d"]);
  });

  it("an RFP's technical proposal stays a technical proposal beside an 'expression of interest letter' form", () => {
    const files = plannedSubmissionTargetFiles(buildSubmissionPlan(TENDERS["no named files: technical and financial proposals, a form"] as never));
    const main = files.find((f) => f.envelope === "TECHNICAL")!;
    assert.equal(main.documentType, "TECHNICAL_PROPOSAL");
    assert.match(main.exactFileName, /^Technical Proposal\./);
    assert.ok(files.some((f) => f.envelope === "FINANCIAL"), "the financial proposal is its own file");
    const eoi = plannedSubmissionTargetFiles(buildSubmissionPlan(TENDERS["one combined EOI file"] as never));
    assert.equal(eoi[0]!.documentType, "EXPRESSION_OF_INTEREST", "a real EOI is still an EOI");
  });
});
