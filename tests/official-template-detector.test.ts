import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { detectOfficialTemplateRequirement } from "../lib/engine/official-template-detector";

describe("official tender template detector", () => {
  it("detects explicit attached template instructions", () => {
    const result = detectOfficialTemplateRequirement({
      title: "Financial offer",
      description: "Bidders must use the attached standard financial template and must not modify the format.",
      exactFileName: "Financial Offer.xlsx",
    });
    assert.equal(result.required, true);
    assert.equal(result.confidence, "HIGH");
  });

  it("detects rate card and BOQ workbook requirements", () => {
    const result = detectOfficialTemplateRequirement({
      title: "Rate Card",
      description: "Complete the provided Excel rate card.",
      exactFileName: "Annex-H-Rate-Card.xlsx",
    });
    assert.equal(result.required, true);
  });

  it("does not classify normal company-produced methodology as an official form", () => {
    const result = detectOfficialTemplateRequirement({
      title: "Technical methodology and work plan",
      description: "Prepare a methodology for the assignment.",
      exactFileName: "Technical-Proposal.docx",
    });
    assert.equal(result.required, false);
  });

  it("detects bid form and declaration form rows", () => {
    assert.equal(detectOfficialTemplateRequirement({ title: "Bid Form" }).required, true);
    assert.equal(detectOfficialTemplateRequirement({ title: "Declaration Form" }).required, true);
  });
});
