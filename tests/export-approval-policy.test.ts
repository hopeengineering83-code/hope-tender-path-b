import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateExportApproval } from "../lib/engine/export-approval-policy";

describe("final export approval policy", () => {
  it("allows final export only when review is authority ready", () => {
    const decision = evaluateExportApproval("AUTHORITY_READY");
    assert.equal(decision.ok, true);
    assert.equal(decision.httpStatus, 200);
  });

  it("blocks final export when review needs review", () => {
    const decision = evaluateExportApproval("NEEDS_REVIEW");
    assert.equal(decision.ok, false);
    assert.equal(decision.httpStatus, 422);
    assert.equal(decision.code, "REVIEW_NOT_READY");
  });

  it("blocks final export when review is blocked", () => {
    const decision = evaluateExportApproval("BLOCKED");
    assert.equal(decision.ok, false);
    assert.equal(decision.httpStatus, 422);
    assert.equal(decision.code, "REVIEW_BLOCKED");
  });
});
