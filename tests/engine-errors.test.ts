import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { actionableEngineError } from "../app/api/tenders/[id]/engine/route";

describe("actionableEngineError", () => {
  it("maps timeout failures to ENGINE_TIMEOUT", () => {
    const mapped = actionableEngineError(new Error("operation timed out after 60s"));
    assert.equal(mapped.status, 504);
    assert.equal(mapped.body.code, "ENGINE_TIMEOUT");
    assert.equal(mapped.body.nextAction, "RETRY_OR_REDUCE_INPUT");
  });

  it("maps database/runtime failures to ENGINE_DATABASE_ERROR", () => {
    const mapped = actionableEngineError(new Error("Prisma connection failed during transaction"));
    assert.equal(mapped.status, 503);
    assert.equal(mapped.body.code, "ENGINE_DATABASE_ERROR");
    assert.equal(mapped.body.nextAction, "RETRY_AFTER_DATABASE_CHECK");
  });

  it("maps missing tender failures to TENDER_NOT_FOUND", () => {
    const mapped = actionableEngineError(new Error("Tender not found"));
    assert.equal(mapped.status, 404);
    assert.equal(mapped.body.code, "TENDER_NOT_FOUND");
    assert.equal(mapped.body.nextAction, "OPEN_TENDER_LIST");
  });

  it("maps unknown failures to ENGINE_FAILED with detail", () => {
    const mapped = actionableEngineError(new Error("unexpected parser issue"));
    assert.equal(mapped.status, 500);
    assert.equal(mapped.body.code, "ENGINE_FAILED");
    assert.equal(mapped.body.detail, "unexpected parser issue");
    assert.equal(mapped.body.nextAction, "OPEN_EXTRACTION_ANALYSIS_MATCHING_QUALITY");
  });
});
