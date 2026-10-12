// The compliance matrix and the summary do not overstate what the package holds.
//
// A hosted package rated "Annexes / Supporting Documents" FULLY MET beside
// evidence reading "partially evidenced from proposal narrative", although the
// package carries no annex (the proposal offers the documents on request). Its
// Executive Summary said "Section F sets each of the tender's 5 evaluation
// criteria" above a Section F of eight rows (required contents and criteria).
// Fixtures are generic.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { applyProposalQualityRepairAddenda, statusForRequirement } from "../lib/engine/proposal-quality-repair";

const input = {
  tenderTitle: "Clinic Design",
  clientName: "County Office",
  requirements: [
    "Annexes / Supporting Documents — copies of CVs, licences and certificates.",
    "Relevant clinic design experience with client references.",
  ],
  expertLines: ["Reviewed expert: Alex Person — Architect, CV and licence on file."],
  projectLines: ["Reviewed project: District Clinic design, client references on file."],
  companyEvidenceLines: ["Company evidence: licence and certificates on file."],
  projectEvidenceLines: [],
  complianceLines: [],
  differentiators: [],
};

describe("the compliance matrix does not overstate", () => {
  it("never rates an attachment requirement fully met, even on direct evidence", () => {
    assert.equal(statusForRequirement("Annexes / Supporting Documents — copies of CVs and certificates.", "DIRECT"), "PARTIALLY MET");
    assert.equal(statusForRequirement("Relevant clinic design experience with client references.", "DIRECT"), "FULLY MET");
  });

  it("the annex row in Section E is not fully met", () => {
    const md = applyProposalQualityRepairAddenda("# Cover Letter\n\nText.", input as never);
    const row = md.split("\n").find((line) => /^\| Annexes/.test(line)) ?? "";
    assert.ok(row, "the annex row is in Section E");
    assert.doesNotMatch(row, /FULLY MET/);
  });

  it("the summary does not count criteria Section F does not list alone", () => {
    const src = readFileSync("lib/engine/executive-summary-composer.ts", "utf8");
    assert.doesNotMatch(src, /Section F sets each of the tender's \$\{input\.evaluationCriteriaCount\}/);
  });
});
