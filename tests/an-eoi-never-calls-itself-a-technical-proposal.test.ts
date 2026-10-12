/**
 * The whole-document fallback writes an EOI as an EOI, and claims no
 * experience the record does not hold.
 *
 * 2026-10-01, Preview, a telecom-tower EOI (inspect run 36876028650): with
 * every section on its deterministic text the delivered EOI opened "Subject:
 * Technical Proposal for …", "This is a TECHNICAL PROPOSAL ONLY", promised
 * "comparable project references" and team members "each with prior
 * comparable delivery experience" for a tender where no project was selected,
 * printed a differentiators lead-in over nothing, and declared the firm "not
 * under any current debarment" ahead of the owner's own signed declaration.
 *
 * Generic fixtures.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { withSubmissionDocumentLabel } from "../lib/engine/generate-elite";
import { buildCoverLetterOpener, buildExecutiveSummaryOpener } from "../lib/engine/benchmark-tables";
import { buildConflictOfInterestSection } from "../lib/engine/understanding-and-value-added";

describe("the document calls itself what the plan says it is", () => {
  const md = "Subject: Technical Proposal for Mast Maintenance\n\nNote: This is a TECHNICAL PROPOSAL ONLY. No financial offer is included.\n\nWe submit this technical proposal.";
  it("an EOI is an Expression of Interest throughout", () => {
    const out = withSubmissionDocumentLabel(md, "Expression of Interest");
    assert.doesNotMatch(out, /technical proposal/i);
    assert.match(out, /Subject: Expression of Interest for/);
    assert.match(out, /this Expression of Interest\./);
  });
  it("a technical proposal is left as written", () => {
    assert.equal(withSubmissionDocumentLabel(md, "Technical Proposal"), md);
  });
});

describe("no project, no claim of comparable experience", () => {
  it("the openers promise nothing the record lacks", () => {
    const cover = buildCoverLetterOpener({ companyName: "S", clientName: "C", tenderTitle: "T", projects: [] });
    const summary = buildExecutiveSummaryOpener({ companyName: "S", clientName: "C", projects: [], reviewedExpertCount: 3 });
    for (const text of [cover, summary]) assert.doesNotMatch(text, /comparable/i);
  });
});

describe("the firm's legal history is the owner's declaration", () => {
  it("D.5 does not state the firm's debarment status", () => {
    assert.doesNotMatch(buildConflictOfInterestSection({ companyName: "S", clientName: "C", tenderTitle: "T" }), /debar/i);
  });
});

import { buildEvaluatorMirrorSection } from "../lib/engine/evaluator-mirror-builder";

describe("Section F answers a legal-history criterion with the declaration", () => {
  it("points declaration and company-record criteria at the right place, not at projects or experts", () => {
    const md = buildEvaluatorMirrorSection({
      evaluationCriteria: ["Litigation History", "History of Non-Performing Contracts", "Legal Status", "Financial Standing"],
      evaluationWeights: [], primarySector: "x", topExpertName: "A. Engineer",
    } as never)!;
    const row = (name: string) => md.split("\n").find((line) => line.startsWith(`| ${name} |`))!;
    for (const name of ["Litigation History", "History of Non-Performing Contracts"]) {
      assert.match(row(name), /Declaration/);
      assert.doesNotMatch(row(name), /Featured Projects|lead expert/);
    }
    for (const name of ["Legal Status", "Financial Standing"]) {
      assert.doesNotMatch(row(name), /lead expert|Section A–D/);
    }
  });
});

import { readFileSync } from "node:fs";
import { amplifySectionCDepth } from "../lib/engine/section-c-depth-amplifier";
import { buildValueFrameworkTable } from "../lib/engine/benchmark-tables";

// 2026-10-01, inspect run 36879342204: with no comparable project selected,
// the Section C amplifier still said "validated delivery experience across
// comparable assignment types", D.2 said the experts "performed the same roles
// on comparable previous projects", and the fallback's Section B promised
// "project references demonstrating comparable experience ... as attachments".
describe("deterministic text claims no comparable work it cannot show", () => {
  it("the Section C amplifier, without a project, claims none", () => {
    const md = "# Section C: Technical Approach\n\n## C.1 Understanding of the Assignment\n\nShort.\n\n## C.2 Technical Methodology\n\nShort.\n\n## C.3 Work Plan and Deliverables\n\nShort.\n\n# Section D: Additional Information\n\nx";
    const out = amplifySectionCDepth(md, { primarySector: "General Consultancy / Engineering", projects: [], companyName: "S" }).markdown;
    assert.doesNotMatch(out, /comparable/i);
  });

  it("the value framework makes no continuity claim", () => {
    const md = buildValueFrameworkTable({ primarySector: "General Consultancy / Engineering", clientName: "C" } as never);
    assert.doesNotMatch(md, /same roles on comparable/i);
  });

  it("the whole-document fallback prints no Section B without a project", () => {
    const source = readFileSync("lib/engine/generate-elite.ts", "utf8");
    assert.doesNotMatch(source, /Detailed project references demonstrating comparable experience/);
    assert.match(source, /if \(projectSelected > 0\) lines\.push\(`# \$\{sectionBLabel\}`\);/);
  });
});

import { detectThemes } from "../lib/engine/proposal-intelligence";

// 2026-10-01, inspect run 36884141758: the whole-document fallback used the
// tender's own section names bare ("Technical Approach"), and the orderer put
// them after the Declaration; /tender.*management/ and /contract.*admin/
// matched words a page apart and planned FIDIC claims administration into a
// telecom-tower EOI.
describe("the fallback's sections are ordered and its themes are the tender's", () => {
  it("section headings carry the letter the orderer reads", () => {
    const source = readFileSync("lib/engine/generate-elite.ts", "utf8");
    assert.match(source, /sectionLabel\(sections\.find\(\(s\) => \/technical approach\|methodology\|section c\/i\.test\(s\)\), "C", "Technical Approach"\)/);
  });

  it("contract administration is not inferred from distant words", () => {
    const text = "The tender will be evaluated by the procurement team. Bidders shall declare non-performance of any contract. Records management is handled by the client's admin office.";
    assert.equal(detectThemes(text).some((t) => t.code === "CONTRACT_ADMINISTRATION"), false);
    assert.equal(detectThemes("Scope: contract administration and claims management under FIDIC.").some((t) => t.code === "CONTRACT_ADMINISTRATION"), true);
  });
});

describe("one incidental phrase does not make a cross-cutting theme", () => {
  it("a debarment clause naming the World Bank and a tax payment certificate select neither theme", () => {
    const text = "Supplier must confirm it is not identified as ineligible by any UN Organization, the World Bank Group, or any other international organization. Submit a Tax Registration/Payment Certificate.";
    const codes = detectThemes(text).map((t) => t.code);
    assert.equal(codes.includes("DONOR_COMPLIANCE"), false);
    assert.equal(codes.includes("CONTRACT_ADMINISTRATION"), false);
  });
  it("a tender about the subject still selects it", () => {
    assert.ok(detectThemes("World Bank financed; ESMP to the ESF safeguards.").some((t) => t.code === "DONOR_COMPLIANCE"));
  });
});
