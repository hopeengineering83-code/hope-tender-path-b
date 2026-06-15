import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { actionableEngineError } from "../lib/engine/infrastructure/actionable-engine-error";

describe("actionableEngineError", () => {
  it("maps timeout failures to ENGINE_TIMEOUT with background-job retry hint", () => {
    const mapped = actionableEngineError(new Error("operation timed out after 60s"));
    assert.equal(mapped.status, 504);
    assert.equal(mapped.body.code, "ENGINE_TIMEOUT");
    // Updated 2026-05: timeouts on Vercel Hobby should always steer
    // users to the async ENGINE_RUN job (60s budget per chunk), not
    // synchronous retry which will hit the same 60s cap.
    assert.equal(mapped.body.nextAction, "RETRY_AS_BACKGROUND_JOB");
    assert.ok(mapped.body.error.includes("operation timed out after 60s"));
  });

  it("maps Vercel FUNCTION_INVOCATION_TIMEOUT to ENGINE_TIMEOUT", () => {
    // Production screenshot showed "FUNCTION_INVOCATION_TIMEOUT sfo1::cj4lk-..."
    // — the engine route crashed at the Vercel function-invocation
    // layer (not within the route's own catch). Confirm we still map
    // it cleanly to ENGINE_TIMEOUT so the UI shows the background-job
    // hint instead of NON_JSON_RESPONSE.
    const mapped = actionableEngineError(new Error("FUNCTION_INVOCATION_TIMEOUT sfo1::cj4lk-1778959201236-5d95d5e9a2b2"));
    assert.equal(mapped.body.code, "ENGINE_TIMEOUT");
    assert.equal(mapped.body.nextAction, "RETRY_AS_BACKGROUND_JOB");
  });

  it("maps database/runtime failures to ENGINE_DATABASE_ERROR", () => {
    const mapped = actionableEngineError(new Error("Prisma connection failed during transaction"));
    assert.equal(mapped.status, 503);
    assert.equal(mapped.body.code, "ENGINE_DATABASE_ERROR");
    assert.equal(mapped.body.nextAction, "RETRY_AFTER_DATABASE_CHECK");
    assert.ok(mapped.body.error.includes("Prisma connection failed"));
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
    assert.ok(mapped.body.error.includes("unexpected parser issue"));
  });

  it("truncates very long details in the user-facing error", () => {
    const longMessage = `unexpected ${"x".repeat(400)}`;
    const mapped = actionableEngineError(new Error(longMessage));
    assert.equal(mapped.body.detail, longMessage);
    assert.ok(mapped.body.error.length < longMessage.length);
    assert.ok(mapped.body.error.endsWith("..."));
  });
});
