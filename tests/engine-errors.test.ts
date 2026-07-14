import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { actionableEngineError } from "../lib/engine/actionable-engine-error";

describe("actionableEngineError", () => {
  it("maps timeout failures to ENGINE_TIMEOUT with background-job retry hint", () => {
    const mapped = actionableEngineError(new Error("operation timed out after 60s"));
    assert.equal(mapped.status, 504);
    assert.equal(mapped.body.code, "ENGINE_TIMEOUT");
    // Updated 2026-05: timeouts on Vercel Hobby should always steer
    // users to the async ENGINE_RUN job (60s budget per chunk), not
    // synchronous retry which will hit the same 60s cap.
    assert.equal(mapped.body.nextAction, "RETRY_AS_BACKGROUND_JOB");
    // SECURITY: the raw error message MUST NOT appear in the public response.
    // The error field is a safe static summary, not the raw exception text.
    assert.ok(!mapped.body.error.includes("operation timed out after 60s"));
    assert.ok(mapped.body.error.includes("timed out"));
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
    // SECURITY: the raw Vercel internal ID must NOT appear in the response.
    assert.ok(!JSON.stringify(mapped.body).includes("sfo1::"));
  });

  it("maps database/runtime failures to ENGINE_DATABASE_ERROR", () => {
    const mapped = actionableEngineError(new Error("Prisma connection failed during transaction"));
    assert.equal(mapped.status, 503);
    assert.equal(mapped.body.code, "ENGINE_DATABASE_ERROR");
    assert.equal(mapped.body.nextAction, "RETRY_AFTER_DATABASE_CHECK");
    // SECURITY: the raw error message MUST NOT appear in the public response.
    assert.ok(!mapped.body.error.includes("Prisma connection failed"));
    assert.ok(mapped.body.error.includes("database"));
  });

  it("maps missing tender failures to TENDER_NOT_FOUND", () => {
    const mapped = actionableEngineError(new Error("Tender not found"));
    assert.equal(mapped.status, 404);
    assert.equal(mapped.body.code, "TENDER_NOT_FOUND");
    assert.equal(mapped.body.nextAction, "OPEN_TENDER_LIST");
    // SECURITY: no raw error message in the response body.
    assert.ok(!JSON.stringify(mapped.body).includes("Tender not found"));
  });

  it("maps unknown failures to ENGINE_FAILED without leaking raw detail", () => {
    const mapped = actionableEngineError(new Error("unexpected parser issue"));
    assert.equal(mapped.status, 500);
    assert.equal(mapped.body.code, "ENGINE_FAILED");
    // SECURITY: the `detail` field was removed — it previously leaked
    // raw error.message. Confirm it is absent.
    assert.equal((mapped.body as Record<string, unknown>).detail, undefined);
    assert.equal(mapped.body.nextAction, "OPEN_EXTRACTION_ANALYSIS_MATCHING_QUALITY");
    // The error field is a safe static summary, not the raw exception text.
    assert.ok(!mapped.body.error.includes("unexpected parser issue"));
  });

  it("does not leak very long raw error messages", () => {
    const longMessage = `unexpected ${"x".repeat(400)}`;
    const mapped = actionableEngineError(new Error(longMessage));
    // SECURITY: no `detail` field, no raw message in `error`.
    assert.equal((mapped.body as Record<string, unknown>).detail, undefined);
    assert.ok(!mapped.body.error.includes("unexpected"));
    assert.ok(!JSON.stringify(mapped.body).includes("x".repeat(50)));
  });
});
