// Section C numbering has exactly one authority.
//
// THE DELIVERED DEFECT
// --------------------
// A submitted Technical Proposal's contents page read:
//
//     C.0, C.1, C.3, C.4, C.6, C.2, C.5a, C.6a, C.7
//
// Eight producers each assigned their own C.x, and the numbers collided by
// meaning: "Work Plan" was C.3 in proposal-sections.ts and
// section-c-depth-amplifier.ts but C.6 in generate-elite.ts; "Quality
// Assurance" was C.4 in those first two and C.3 in benchmark-tables.ts;
// sector-vocabulary-enricher.ts also claimed C.4. Where two producers landed on
// one number, duplicate-section-suppressor.ts appended a letter — hence C.5a
// and C.6a.
//
// Sorting would not have fixed that. These tests pin the property that matters:
// one number never means two things, the order is canonical and deterministic,
// and optional sub-sections cannot corrupt the numbering of the others.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  normalizeSectionC,
  identifySectionCHeading,
  sectionCTitle,
} from "../lib/engine/section-c-authority";

/** Build a Section C block from raw producer headings, as they really arrive. */
function sectionC(headings: string[], trailing = "\n# Section D: Additional Information\n\nBody.\n"): string {
  const body = headings.map((h) => `## ${h}\n\nParagraph for ${h}.\n`).join("\n");
  return `# Proposal\n\n# Section C: Technical Approach\n\n${body}${trailing}`;
}

function headingsOf(markdown: string): string[] {
  const start = markdown.split("\n").findIndex((l) => /^#\s+Section\s+C\b/i.test(l));
  const lines = markdown.split("\n").slice(start + 1);
  const out: string[] = [];
  for (const line of lines) {
    if (/^#\s+\S/.test(line)) break;
    const m = line.match(/^##\s+(.*)$/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

describe("Section C sub-sections have one canonical identity, title and order", () => {
  it("identifies each producer's wording as the same semantic sub-section", () => {
    // The exact strings the real producers emit.
    assert.equal(identifySectionCHeading("C.3 Work Plan and Deliverables"), "WORK_PLAN");
    assert.equal(identifySectionCHeading("C.6 Work Plan and Schedule"), "WORK_PLAN");
    assert.equal(identifySectionCHeading("C.4 Quality Assurance"), "QUALITY_ASSURANCE");
    assert.equal(identifySectionCHeading("C.3 Quality Assurance: Three-Stage Review"), "QUALITY_ASSURANCE");
    assert.equal(identifySectionCHeading("C.4 Sector-Specific Technical Standards Applied"), "SECTOR_STANDARDS");
    assert.equal(identifySectionCHeading("C.5 Risk Register and Mitigation Strategy"), "RISK");
    assert.equal(identifySectionCHeading("C.0 Tender Specifics Recognised by This Proposal"), "TENDER_SPECIFICS");
    assert.equal(identifySectionCHeading("C.1 Understanding of the Assignment"), "UNDERSTANDING");
    assert.equal(identifySectionCHeading("C.2 Technical Methodology"), "METHODOLOGY");
    // A tender-driven criterion response is not owned here and stays possible.
    assert.equal(identifySectionCHeading("C.5a Relevant project experience"), null);
  });

  it("gives one client-facing title per identity", () => {
    assert.equal(sectionCTitle("WORK_PLAN"), "Work Plan and Deliverables");
    assert.equal(sectionCTitle("QUALITY_ASSURANCE"), "Quality Assurance");
  });
});

describe("normalizeSectionC repairs the delivered defect", () => {
  it("turns the real shipped sequence into canonical order with no duplicate numbers", () => {
    const md = sectionC([
      "C.0 Tender Specifics Recognised by This Proposal",
      "C.1 Understanding of the Assignment",
      "C.3 Quality Assurance: Three-Stage Review",
      "C.4 Sector-Specific Technical Standards Applied",
      "C.6 Work Plan and Schedule",
      "C.2 Technical Methodology",
      "C.5a Relevant project experience",
      "C.6a Team qualifications and comparable previous roles",
      "C.7 Company capacity",
    ]);

    const result = normalizeSectionC(md);
    const out = headingsOf(result.markdown);

    // Canonical order, sequential numbering, no gaps, no letter suffixes.
    assert.deepEqual(out, [
      "C.1 Tender Specifics Recognised by This Proposal",
      "C.2 Understanding of the Assignment",
      "C.3 Technical Methodology",
      "C.4 Work Plan and Deliverables",
      "C.5 Quality Assurance",
      "C.6 Sector-Specific Technical Standards Applied",
      "C.7 Relevant project experience",
      "C.8 Team qualifications and comparable previous roles",
      "C.9 Company capacity",
    ]);

    const numbers = out.map((h) => h.split(" ")[0]);
    assert.equal(new Set(numbers).size, numbers.length, "no duplicate numbers");
    assert.ok(
      !out.some((h) => /^C\.\d+[a-z]\b/.test(h)),
      `no disambiguating letter suffixes remain in headings: ${out.join(" | ")}`,
    );
  });

  it("never lets one number mean two things", () => {
    // Both producers of "Quality Assurance" present at once, under the two
    // different numbers they really use.
    const md = sectionC([
      "C.1 Understanding of the Assignment",
      "C.3 Quality Assurance: Three-Stage Review",
      "C.4 Quality Assurance",
      "C.2 Technical Methodology",
    ]);
    const out = headingsOf(normalizeSectionC(md).markdown);

    const qa = out.filter((h) => /Quality Assurance/i.test(h));
    assert.equal(qa.length, 1, `the same sub-section must appear once, got: ${out.join(" | ")}`);
    const numbers = out.map((h) => h.split(" ")[0]);
    assert.equal(new Set(numbers).size, numbers.length);
  });

  it("keeps both bodies when two producers emit the same sub-section", () => {
    const md = `# Section C: Technical Approach\n\n`
      + `## C.3 Quality Assurance: Three-Stage Review\n\nThree-stage gate detail.\n\n`
      + `## C.4 Quality Assurance\n\nSecond quality paragraph.\n\n`
      + `# Section D: Additional Information\n\nBody.\n`;
    const result = normalizeSectionC(md);
    assert.match(result.markdown, /Three-stage gate detail\./);
    assert.match(result.markdown, /Second quality paragraph\./, "the merged body must not be discarded");
  });

  it("is deterministic and idempotent", () => {
    const md = sectionC([
      "C.6 Work Plan and Schedule",
      "C.1 Understanding of the Assignment",
      "C.2 Technical Methodology",
    ]);
    const once = normalizeSectionC(md).markdown;
    const twice = normalizeSectionC(once).markdown;
    assert.equal(once, twice, "a second pass must change nothing");
    assert.equal(normalizeSectionC(md).markdown, once, "same input, same output");
  });
});

describe("optional sub-sections do not corrupt the numbering", () => {
  const base = [
    "C.1 Understanding of the Assignment",
    "C.2 Technical Methodology",
    "C.3 Work Plan and Deliverables",
    "C.4 Quality Assurance",
  ];

  it("numbers a minimal Section C without gaps", () => {
    const out = headingsOf(normalizeSectionC(sectionC(base)).markdown);
    assert.deepEqual(out.map((h) => h.split(" ")[0]), ["C.1", "C.2", "C.3", "C.4"]);
  });

  for (const optional of [
    "C.0 Tender Specifics Recognised by This Proposal",
    "C.4 Sector-Specific Technical Standards Applied",
    "C.5 Risk Register and Mitigation Strategy",
  ]) {
    it(`stays gapless and duplicate-free when "${optional.slice(0, 28)}…" is present`, () => {
      const out = headingsOf(normalizeSectionC(sectionC([...base, optional])).markdown);
      const numbers = out.map((h) => h.split(" ")[0]);
      assert.deepEqual(numbers, ["C.1", "C.2", "C.3", "C.4", "C.5"]);
      assert.equal(new Set(numbers).size, numbers.length);
      // The four fixed sub-sections are all still present exactly once.
      for (const title of ["Understanding of the Assignment", "Technical Methodology", "Work Plan and Deliverables", "Quality Assurance"]) {
        assert.equal(out.filter((h) => h.includes(title)).length, 1, `${title} once`);
      }
    });
  }

  it("carries C.2.x methodology sub-sub-sections with their parent", () => {
    const md = `# Section C: Technical Approach\n\n`
      + `## C.6 Work Plan and Schedule\n\nWork plan body.\n\n`
      + `## C.2 Technical Methodology\n\nIntro.\n\n### C.2.1 Site Investigation\n\nStep one.\n\n### C.2.2 Detailed Design\n\nStep two.\n\n`
      + `# Section D\n\nBody.\n`;
    const result = normalizeSectionC(md);
    const methodologyIdx = result.markdown.indexOf("Technical Methodology");
    const stepIdx = result.markdown.indexOf("### C.2.1 Site Investigation");
    const workPlanIdx = result.markdown.indexOf("Work Plan and Deliverables");
    assert.ok(methodologyIdx > -1 && stepIdx > methodologyIdx, "steps stay under methodology");
    assert.ok(methodologyIdx < workPlanIdx, "methodology precedes work plan in canonical order");
    assert.match(result.markdown, /### C\.2\.2 Detailed Design/, "sub-sub-headings untouched");
  });

  it("leaves everything outside Section C alone", () => {
    const md = `# Section B: Relevant Experience\n\n## B.1 Client References\n\nRefs.\n\n`
      + `# Section C: Technical Approach\n\n## C.6 Work Plan and Schedule\n\nPlan.\n\n`
      + `# Section D: Additional Information\n\n## D.1 Value Framework\n\nValue.\n`;
    const out = normalizeSectionC(md).markdown;
    assert.match(out, /## B\.1 Client References/, "Section B untouched");
    assert.match(out, /## D\.1 Value Framework/, "Section D untouched");
    assert.match(out, /## C\.1 Work Plan and Deliverables/);
  });

  it("does nothing when there is no Section C", () => {
    const md = "# Section A: Company Profile\n\n## A.1 Overview\n\nBody.\n";
    const result = normalizeSectionC(md);
    assert.equal(result.markdown, md);
    assert.deepEqual(result.numbers, []);
  });
});
