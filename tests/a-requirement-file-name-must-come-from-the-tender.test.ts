// 2026-09-28, Preview, accept run 36452678140: re-running AI Analyze wrote the
// stored names of the owner's Company Vault uploads ("Expert CVS.pdf.txt",
// "Projects Reference.pdf.txt", "…Summary.docx.txt") onto requirements as
// their exactFileName. The Build Plan made two of them required submission
// files and a READY package became blocked on documents nobody asked for.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { sourceGroundedExactFileName } from "../lib/engine/source-grounded-file-name";

const tender = [
  "Submission: the Technical Proposal shall be submitted as one PDF by email.",
  "Include CVs of the proposed experts and a list of project references.",
  'Name the file "Lot 2 - Technical Offer.pdf".',
].join("\n");

describe("a requirement's file name must come from the tender", () => {
  it("drops a stored vault file name the tender never states", () => {
    assert.equal(sourceGroundedExactFileName("Expert CVS.pdf.txt", [tender]), null);
    assert.equal(sourceGroundedExactFileName("Projects Reference.pdf.txt", [tender]), null);
    assert.equal(sourceGroundedExactFileName("02_Legal_Registration_Documents_Summary.docx.txt", [tender]), null);
    assert.equal(sourceGroundedExactFileName("Company Registration.pdf", [tender]), null);
  });

  it("keeps a name the tender states, in full or by its base name", () => {
    assert.equal(sourceGroundedExactFileName("Lot 2 - Technical Offer.pdf", [tender]), "Lot 2 - Technical Offer.pdf");
    assert.equal(sourceGroundedExactFileName("Technical Proposal.pdf", [tender]), "Technical Proposal.pdf");
    assert.equal(sourceGroundedExactFileName("Scope.pdf.txt", ['Upload "Scope.pdf.txt" to the portal.']), "Scope.pdf.txt");
  });

  it("leaves the value alone when there is no source text to check", () => {
    assert.equal(sourceGroundedExactFileName("Technical Proposal.pdf", []), "Technical Proposal.pdf");
    assert.equal(sourceGroundedExactFileName(null, [tender]), null);
  });

  it("guards every path that stores an analysed requirement", () => {
    const service = readFileSync("lib/ai-jobs/analysis-job-service.ts", "utf8");
    assert.match(service, /exactFileName: sourceGroundedExactFileName\(req\.exactFileName, fileTextById/);
    const route = readFileSync("app/api/tenders/[id]/ai-analyze/route.ts", "utf8");
    assert.equal(route.match(/exactFileName: sourceGroundedExactFileName\(req\.exactFileName,/g)?.length, 2);
    assert.doesNotMatch(route, /exactFileName: req\.exactFileName \?\? null/);
  });
});
