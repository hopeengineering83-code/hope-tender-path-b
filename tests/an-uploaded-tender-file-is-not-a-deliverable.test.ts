/**
 * The tender's own upload name is not a file the tender asks for.
 *
 * 2026-09-29, Preview: a tender uploaded as "Path tender.pdf" got a confirmed
 * Build Plan whose first required file was "Path tender.pdf"
 * (canonicalId exact-path-tender, TENDER_REQUIRED_FILE). AI Analyze reads each
 * chunk under a [FILE_ID:…|FILE_NAME:<upload name>] header and returned the
 * upload's name in exactFileNaming; buildCanonicalAnalysisTenderUpdate wrote
 * that list through unchecked, so auto-finalize waited forever for "the
 * tender-issued original" of the RFP itself.
 *
 * Fixture is generic (an office fit-out RFP), not the benchmark tender.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { sourceGroundedTenderFileNames } from "../lib/engine/source-grounded-file-name";
import { buildCanonicalAnalysisTenderUpdate } from "../lib/engine/canonical-analysis-update";
import { buildSubmissionPlan } from "../lib/engine/submission-plan";

const RFP_TEXT = [
  "REQUEST FOR PROPOSALS — Office Fit-out Design Services",
  "The Consultant shall submit a Technical Proposal including the Company Profile and the Technical Approach and Methodology.",
  "Bidders shall complete and sign the Annex 2 Bid Form issued with this RFP.",
].join("\n");

const FORM_TEXT = "ANNEX 2 BID FORM\nName of bidder: ____ Signature: ____";

describe("tender-level file names keep only what the tender states", () => {
  it("drops the name of the uploaded solicitation itself, with or without extension", () => {
    const files = [{ fileName: "Office tender.pdf", originalFileName: "Office tender.pdf", extractedText: RFP_TEXT }];
    assert.deepEqual(sourceGroundedTenderFileNames(["Office tender"], files), []);
    assert.deepEqual(sourceGroundedTenderFileNames(["Office tender.pdf"], files), []);
  });

  it("drops the name even when the solicitation states its own name", () => {
    const files = [{ originalFileName: "Office tender.pdf", extractedText: `${RFP_TEXT}\nThis Office tender is issued by the Agency.` }];
    assert.deepEqual(sourceGroundedTenderFileNames(["Office tender.pdf"], files), []);
  });

  it("keeps a separately uploaded form the RFP names", () => {
    const files = [
      { originalFileName: "RFP.pdf", extractedText: RFP_TEXT },
      { originalFileName: "Annex 2 Bid Form.docx", extractedText: FORM_TEXT },
    ];
    assert.deepEqual(sourceGroundedTenderFileNames(["Annex 2 Bid Form.docx"], files), ["Annex 2 Bid Form.docx"]);
  });

  it("keeps a stated deliverable name and drops one the tender never states", () => {
    const files = [{ originalFileName: "RFP.pdf", extractedText: RFP_TEXT }];
    assert.deepEqual(
      sourceGroundedTenderFileNames(["Technical Proposal.pdf", "Pricing Workbook.xlsx"], files),
      ["Technical Proposal.pdf"],
    );
  });
});

describe("AI Analyze's canonical write never plans the uploaded solicitation", () => {
  it("the stored list, and so the Build Plan, does not name the upload", () => {
    const files = [{ id: "f1", fileName: "Office tender.pdf", originalFileName: "Office tender.pdf", extractedText: RFP_TEXT }];
    const { data } = buildCanonicalAnalysisTenderUpdate(
      { summary: "s", requirements: [], exactFileNaming: ["Office tender"], exactFileOrder: ["Office tender"] } as any,
      { sourceFiles: files },
    );
    assert.equal(data.exactFileNaming, "[]");
    assert.equal(data.exactFileOrder, "[]");

    const plan = buildSubmissionPlan({
      id: "t1",
      exactFileNaming: data.exactFileNaming as string,
      exactFileOrder: data.exactFileOrder as string,
      requirements: [],
    });
    assert.equal(plan.files.some((file) => /office tender/i.test(file.exactFileName)), false);
  });

  it("without the fix the same model output plans the upload (the defect)", () => {
    const plan = buildSubmissionPlan({ id: "t1", exactFileNaming: JSON.stringify(["Office tender"]), requirements: [] });
    assert.equal(plan.files.some((file) => /office tender/i.test(file.exactFileName)), true);
  });
});
