/**
 * Every "where answered" pointer names a section the proposal has, and
 * Section F agrees with Section E about the same requirement.
 *
 * 2026-10-05, a delivered EOI: Section E pointed "Previous … Experience" at
 * "Section B.2 Project Portfolio" in a document with no Section B, and
 * "Audited Financial Statements" at "Section D …" where the heading was D.4.
 * Section F rated the experience row "DIRECT" beside E's "PARTIALLY MET" and
 * three declarations "PARTIAL" beside E's "FULLY MET".
 *
 * Generic fixture: a water-utility consultancy EOI.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { reconcileSectionPointers } from "../lib/engine/section-pointer-reconciliation";
import { applyProposalQualityRepairAddenda } from "../lib/engine/proposal-quality-repair";

const DOC = [
  "# Section A: Company Profile",
  "## A.1 Company Background",
  "## A.3 Proposed Project Team",
  "# Section C: Technical Approach",
  "## C.3 Technical Methodology",
  "## C.4 Work Plan and Deliverables",
  "## C.6 Risk Register and Mitigation Strategy",
  "# Section D: Additional Information",
  "## D.4 Professional Certifications and Affiliations",
  "# SECTION E: COMPLIANCE MATRIX",
  "| # | Requirement (paraphrased from tender) | Where Addressed in This Proposal | Supporting Evidence / Mitigation | Compliance Status |",
  "|---|---|---|---|---|",
  "| 1 | Audited Financial Statements [p.3] | Section D Professional Certifications and Affiliations | Audited accounts 2023–2025 | FULLY MET |",
  "| 2 | Previous Pumping Station Experience [p.3] | Section B.2 Project Portfolio | — | PARTIALLY MET |",
  "| 3 | Declaration of Non-Debarment [p.2] | Declaration | The company's signed declaration | FULLY MET |",
  "| 4 | Work Plan [p.4] | Section C.6 Work Plan and Schedule | — | FULLY MET |",
  "## Section F: Response to Evaluation Criteria",
  "| Evaluation criterion | Weight / priority | Where this proposal answers it | Evidence strength |",
  "|---|---|---|---|",
  "| Previous Pumping Station Experience — Demonstrate completed pumping stations. | Scored criterion | Section B.2 Project Portfolio | DIRECT |",
  "| Declaration of Non-Debarment — Confirm the firm is not debarred. | Mandatory / pass-fail | Sections A–D | PARTIAL |",
  "| Methodology quality | Scored criterion | Section C.2 Technical Methodology + C.5 Risk Register | — |",
  "",
  "Featured project: Riverbend Intake (see Section B.2). Method in (see Section C.3).",
].join("\n");

const cell = (markdown: string, firstCell: RegExp, column: number) => {
  const row = markdown.split("\n").find((line) => firstCell.test(line)) ?? "";
  return row.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim())[column];
};

describe("reconcileSectionPointers", () => {
  const { markdown } = reconcileSectionPointers(DOC);

  it("resolves a pointer to the real heading by its title", () => {
    assert.equal(cell(markdown, /Audited Financial Statements/, 2), "Section D.4 Professional Certifications and Affiliations");
    assert.equal(cell(markdown, /^\| 4 \| Work Plan/, 2), "Section C.4 Work Plan and Deliverables");
  });

  it("says a section is not presented rather than naming one the document lacks", () => {
    assert.equal(cell(markdown, /^\| 2 \| Previous Pumping/, 2), "Not presented in this proposal");
  });

  it("keeps non-numbered locations", () => {
    assert.equal(cell(markdown, /^\| 3 \| Declaration/, 2), "Declaration");
  });

  it("gives Section F the location and status Section E states for the same requirement", () => {
    assert.equal(cell(markdown, /^\| Previous Pumping/, 2), "Not presented in this proposal");
    assert.equal(cell(markdown, /^\| Previous Pumping/, 3), "Partial");
    assert.equal(cell(markdown, /^\| Declaration of Non-Debarment —/, 2), "Declaration");
    assert.equal(cell(markdown, /^\| Declaration of Non-Debarment —/, 3), "Full");
  });

  it("resolves compound pointers in a criterion that is not a Section E row", () => {
    assert.equal(cell(markdown, /^\| Methodology quality/, 2), "Section C.3 Technical Methodology + Section C.6 Risk Register and Mitigation Strategy");
  });

  it("removes a (see Section X) the document cannot satisfy and keeps one it can", () => {
    assert.match(markdown, /Featured project: Riverbend Intake\. Method in \(see Section C\.3\)\./);
  });

  it("leaves a document whose pointers are already right unchanged", () => {
    const again = reconcileSectionPointers(markdown);
    assert.equal(again.markdown, markdown);
    assert.equal(again.pointersRewritten + again.rowsAlignedToComplianceMatrix, 0);
  });

  it("renumbers a # column a removed row left with a gap", () => {
    const table = "| # | Requirement | Where Addressed in This Proposal | Compliance Status |\n|---|---|---|---|\n| 1 | A | Declaration | FULLY MET |\n| 3 | B | Declaration | FULLY MET |";
    assert.match(reconcileSectionPointers(table).markdown, /\| 2 \| B \|/);
  });

  it("does not touch a table with no location column", () => {
    const table = "| Phase | Deliverable |\n|---|---|\n| Section B.2 Survey | Report |";
    assert.equal(reconcileSectionPointers(table).markdown, table);
  });
});

describe("the generator runs it on the final markdown", () => {
  it("after the contents page is sealed and before the render", () => {
    const source = readFileSync("lib/engine/generate-elite.ts", "utf8");
    const sealed = source.indexOf("reorderSectionsAndRebuildToc(workingMarkdown)");
    const pointers = source.indexOf("reconcileSectionPointers(workingMarkdown)");
    const render = source.indexOf("const finalChildren = rerender");
    assert.ok(sealed > 0 && pointers > sealed && render > pointers);
  });
});

describe("Section F states the requirement's own priority", () => {
  it("a MANDATORY rule worded with \"should\" is pass/fail, not a scored criterion", () => {
    const out = applyProposalQualityRepairAddenda("# Section A: Company Profile\n\nBody.", {
      tenderTitle: "Pumping Station Design EOI",
      clientName: "Riverbend Water Utility",
      requirements: ["Exclusion of Pricing Information — No prices should be provided with this EOI.", "Previous Pumping Station Experience — Demonstrate completed pumping stations."],
      expertLines: [],
      projectLines: [],
      companyEvidenceLines: [],
      projectEvidenceLines: [],
      complianceLines: [],
      differentiators: [],
      requirementPriorities: [
        { title: "Exclusion of Pricing Information", priority: "MANDATORY" },
        { title: "Previous Pumping Station Experience", priority: "SCORED" },
      ],
    });
    const row = (name: RegExp) => out.split("\n").find((line) => line.startsWith("| ") && name.test(line) && /pass-fail|Scored criterion/.test(line)) ?? "";
    assert.match(row(/^\| Exclusion of Pricing Information/), /\| Mandatory \/ pass-fail \|/);
    assert.match(row(/^\| Previous Pumping Station Experience/), /\| Scored criterion \(no weight stated in tender\) \|/);
  });
});
