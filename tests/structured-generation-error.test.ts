// Regression tests for Gap 7 — structured generation errors.
//
// Pins every category we expect the catch block of
// /api/tenders/[id]/generate to map cleanly so the UI never has to
// show the bare "Generation failed." text.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mapGenerationError } from "../lib/engine/structured-generation-error";

describe("mapGenerationError — recognised error categories", () => {
  it("rate limit → 429 with RATE_LIMITED + retry next action", () => {
    const m = mapGenerationError(new Error("Anthropic 429 rate limit exceeded"));
    assert.equal(m.status, 429);
    assert.equal(m.body.code, "RATE_LIMITED");
    assert.equal(m.body.nextAction, "RETRY_AFTER_BACKOFF");
    assert.equal(m.body.success, false);
  });

  it("claude / anthropic error → 502 with AI_PROVIDER_CLAUDE_FAILED", () => {
    const m = mapGenerationError(new Error("Claude API returned overloaded_error"));
    assert.equal(m.status, 502);
    assert.equal(m.body.code, "AI_PROVIDER_CLAUDE_FAILED");
  });

  it("gemini error → 502 with AI_PROVIDER_GEMINI_FAILED", () => {
    const m = mapGenerationError(new Error("Gemini api responded with 500"));
    assert.equal(m.status, 502);
    assert.equal(m.body.code, "AI_PROVIDER_GEMINI_FAILED");
  });

  it("openai / gpt error → 502 with AI_PROVIDER_OPENAI_FAILED", () => {
    const m = mapGenerationError(new Error("OpenAI gpt-4o call failed"));
    assert.equal(m.status, 502);
    assert.equal(m.body.code, "AI_PROVIDER_OPENAI_FAILED");
  });

  it("timeout / abort → 504 with GENERATION_TIMEOUT", () => {
    const m = mapGenerationError(new Error("Request aborted: timeout after 60000ms"));
    assert.equal(m.status, 504);
    assert.equal(m.body.code, "GENERATION_TIMEOUT");
    assert.equal(m.body.nextAction, "RETRY_AS_BACKGROUND_JOB");
  });

  it("prisma / database → 503 with DB_ERROR", () => {
    const m = mapGenerationError(new Error("PrismaClient connection pool timeout"));
    assert.equal(m.status, 503);
    assert.equal(m.body.code, "DB_ERROR");
  });

  it("permission → 403 with AUTHZ_FAILED", () => {
    const m = mapGenerationError(new Error("Forbidden: permission denied"));
    assert.equal(m.status, 403);
    assert.equal(m.body.code, "AUTHZ_FAILED");
  });

  it("unknown error → 500 with GENERATION_FAILED + safe message (no raw leak)", () => {
    const m = mapGenerationError(new Error("Some unknown thing exploded"));
    assert.equal(m.status, 500);
    assert.equal(m.body.code, "GENERATION_FAILED");
    // SECURITY: the raw error message MUST NOT appear in the public response.
    assert.ok(!m.body.message.includes("unknown thing exploded"));
    assert.equal(m.body.message, "Document generation failed.");
    // blockerSummary from opts is allowed but raw error.message is not.
    assert.ok(!JSON.stringify(m.body).includes("unknown thing exploded"));
  });

  it("non-Error caught value still maps cleanly", () => {
    const m = mapGenerationError("plain string error");
    assert.equal(m.status, 500);
    assert.equal(m.body.code, "GENERATION_FAILED");
  });

  it("every mapped body has the structured fields the UI relies on", () => {
    const m = mapGenerationError(new Error("anything"));
    assert.equal(m.body.success, false);
    assert.ok(typeof m.body.code === "string" && m.body.code.length > 0);
    assert.ok(typeof m.body.message === "string" && m.body.message.length > 0);
    assert.ok(typeof m.body.nextAction === "string" && m.body.nextAction.length > 0);
    assert.ok(typeof m.body.diagnosticId === "string" && m.body.diagnosticId.length > 0);
    assert.ok(typeof m.body.failedStage === "string" && m.body.failedStage.length > 0);
    assert.ok(m.body.diagnosticId.startsWith("gen_"), `diagnosticId should start with gen_, got: ${m.body.diagnosticId}`);
  });

  it("caller can override the failedStage tag", () => {
    const m = mapGenerationError(new Error("anything"), { failedStage: "AI_RENDER_SECTION_C" });
    assert.equal(m.body.failedStage, "AI_RENDER_SECTION_C");
  });
});
