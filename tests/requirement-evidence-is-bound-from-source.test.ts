import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { bindRequirementEvidenceToActiveFile, canReprovePromotionGrounding } from "../lib/ai-jobs/analysis-job-service";

const requirement = {
  title: "Submit a technical proposal",
  description: "The bidder must submit the requested technical response.",
  requirementType: "SUBMISSION_RULE",
  priority: "MANDATORY",
  sourceQuote: "The bidder shall submit one technical proposal.",
  sourcePage: null,
  sourceFileToken: null,
};

describe("AI Analyze requirement evidence binding", () => {
  it("permits a manual retry to re-prove only the historical promotion-grounding failure", () => {
    assert.equal(canReprovePromotionGrounding("Promotion blocked: 7 mandatory requirements lack valid source grounding (file/page/quote)."), true);
    assert.equal(canReprovePromotionGrounding("SOURCE_BYTE_DRIFT: uploaded bytes changed"), false);
    assert.equal(canReprovePromotionGrounding("Promotion blocked: requirements were weak"), false);
  });

  it("derives the active file and page from a verbatim quote when the model omits the opaque file token", () => {
    const bound = bindRequirementEvidenceToActiveFile(requirement as never, [{
      id: "file-path",
      extractedText: "Cover page\fThe bidder shall submit one technical proposal.\fAnnex",
      totalPages: 3,
    }]);

    assert.equal(bound.sourceTenderFileId, "file-path");
    assert.equal(bound.sourceFileToken, "file-path");
    assert.equal(bound.sourcePage, 2);
  });

  it("proves page one when the file's later form feeds establish page boundaries", () => {
    const firstPage = bindRequirementEvidenceToActiveFile({
      ...requirement,
      sourceQuote: "Site assessment is mandatory.",
    } as never, [{
      id: "file-path",
      extractedText: "Site assessment is mandatory.\fSecond page",
      totalPages: 2,
    }]);
    assert.equal(firstPage.sourcePage, 1);
    assert.equal(firstPage.sourceTenderFileId, "file-path");
  });

  it("fails closed when the quote is absent or appears in more than one active file", () => {
    const absent = bindRequirementEvidenceToActiveFile(requirement as never, [{
      id: "file-a",
      extractedText: "Different text",
      totalPages: 1,
    }]);
    assert.equal(absent.sourceTenderFileId, undefined);

    const ambiguous = bindRequirementEvidenceToActiveFile(requirement as never, [
      { id: "file-a", extractedText: requirement.sourceQuote, totalPages: 1 },
      { id: "file-b", extractedText: requirement.sourceQuote, totalPages: 1 },
    ]);
    assert.equal(ambiguous.sourceTenderFileId, undefined);
  });

  it("rejects a stated foreign file token instead of rebinding it", () => {
    const foreign = bindRequirementEvidenceToActiveFile({
      ...(requirement as object),
      sourceFileToken: "foreign-file",
    } as never, [{
      id: "active-file",
      extractedText: requirement.sourceQuote,
      totalPages: 1,
    }]);
    assert.equal(foreign.sourceFileToken, "foreign-file");
    assert.equal(foreign.sourceTenderFileId, undefined);
  });
});
