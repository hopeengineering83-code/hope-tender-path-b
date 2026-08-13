import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { resolveAuthorityReviewAvailability } from "../lib/engine/authority-review-availability";

describe("Authority Review availability", () => {
  it("is unavailable until the Build Plan is confirmed", () => {
    assert.deepEqual(resolveAuthorityReviewAvailability({
      buildPlanConfirmed: false,
      requiredDocumentCount: 2,
      missingRequiredCount: 0,
      validDocumentCount: 2,
      generatedDocumentCount: 2,
    }), {
      available: false,
      code: "BUILD_PLAN_CONFIRMATION_REQUIRED",
      reason: "Run Engine must create and source-verify the Build Plan before Authority Review.",
    });
  });

  it("is unavailable when the confirmed plan has no required documents", () => {
    assert.equal(resolveAuthorityReviewAvailability({
      buildPlanConfirmed: true,
      requiredDocumentCount: 0,
      missingRequiredCount: 0,
      validDocumentCount: 0,
      generatedDocumentCount: 0,
    }).code, "BUILD_PLAN_REQUIRED");
  });

  it("is unavailable while any required document is missing", () => {
    assert.equal(resolveAuthorityReviewAvailability({
      buildPlanConfirmed: true,
      requiredDocumentCount: 3,
      missingRequiredCount: 1,
      validDocumentCount: 2,
      generatedDocumentCount: 2,
    }).code, "REQUIRED_DOCUMENTS_MISSING");
  });

  it("is unavailable until every required document is validated", () => {
    assert.equal(resolveAuthorityReviewAvailability({
      buildPlanConfirmed: true,
      requiredDocumentCount: 3,
      missingRequiredCount: 0,
      validDocumentCount: 2,
      generatedDocumentCount: 3,
    }).code, "DOCUMENT_VALIDATION_REQUIRED");
  });

  it("becomes available only for a complete validated required set", () => {
    assert.deepEqual(resolveAuthorityReviewAvailability({
      buildPlanConfirmed: true,
      requiredDocumentCount: 3,
      missingRequiredCount: 0,
      validDocumentCount: 3,
      generatedDocumentCount: 3,
    }), { available: true, code: null, reason: null });
  });
});
