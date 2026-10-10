// Tests for the AI job handler registry.
//
// Coverage:
//   • Every canonical job type has a handler registered.
//   • Each handler validates its required context before invoking
//     downstream work (tenderId / userId / required input fields).
//   • Unknown / future JobType values fall through to null so the
//     worker fails them with a clear "no handler" error.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { getHandler, supportedJobTypes } from "../lib/ai-job-handlers";
import type { JobType } from "../lib/ai-jobs";

const ALL_HANDLERS: JobType[] = [
  "ENGINE_RUN",
  "PROPOSAL_GENERATION",
  "EVALUATOR_SIM",
  "COPILOT_DEEP_ANALYSIS",
  "PROFILE_FACT_EXTRACTION",
];

describe("ai-job-handlers registry", () => {
  it("all canonical JobType values have a handler registered (no orphans)", () => {
    for (const jobType of ALL_HANDLERS) {
      const handler = getHandler(jobType);
      assert.ok(handler, `Expected ${jobType} handler to be registered`);
      assert.equal(typeof handler, "function");
    }
  });

  it("supportedJobTypes() lists every registered handler", () => {
    const types = supportedJobTypes();
    for (const jobType of ALL_HANDLERS) {
      assert.ok(types.includes(jobType), `Expected ${jobType} in supportedJobTypes(), got: ${types.join(", ")}`);
    }
  });

  it("getHandler returns null for unknown job types", () => {
    // Cast through unknown to bypass the JobType compile-time guard — we
    // want to confirm the *runtime* lookup safely returns null for any
    // string we throw at it (e.g. a future JobType added to the schema
    // but not yet wired up in this build).
    const fakeJobType = "DEFINITELY_NOT_A_REAL_JOB_TYPE" as unknown as JobType;
    assert.equal(getHandler(fakeJobType), null);
  });

  it("ENGINE_RUN handler rejects when tenderId is missing", async () => {
    const handler = getHandler("ENGINE_RUN");
    assert.ok(handler);
    await assert.rejects(
      handler({ jobId: "job-1", userId: "user-1", tenderId: null, input: {} }),
      /tenderId/i,
      "Expected ENGINE_RUN to reject when tenderId is null",
    );
  });

  it("does not register the retired standalone AI_REMATCH owner", () => {
    assert.equal(getHandler("AI_REMATCH"), null);
    assert.equal(supportedJobTypes().includes("AI_REMATCH"), false);
  });

  it("PROPOSAL_GENERATION handler rejects when tenderId is missing", async () => {
    const handler = getHandler("PROPOSAL_GENERATION");
    assert.ok(handler);
    await assert.rejects(
      handler({ jobId: "job-3", userId: "user-1", tenderId: null, input: {} }),
      /tenderId/i,
      "Expected PROPOSAL_GENERATION to reject when tenderId is null",
    );
  });

  it("EVALUATOR_SIM handler rejects when tenderId is missing", async () => {
    const handler = getHandler("EVALUATOR_SIM");
    assert.ok(handler);
    await assert.rejects(
      handler({ jobId: "job-4", userId: "user-1", tenderId: null, input: {} }),
      /tenderId/i,
      "Expected EVALUATOR_SIM to reject when tenderId is null",
    );
  });

  it("COPILOT_DEEP_ANALYSIS handler rejects when tenderId is missing", async () => {
    const handler = getHandler("COPILOT_DEEP_ANALYSIS");
    assert.ok(handler);
    await assert.rejects(
      handler({ jobId: "job-5", userId: "user-1", tenderId: null, input: { question: "What are the gaps?" } }),
      /tenderId/i,
      "Expected COPILOT_DEEP_ANALYSIS to reject when tenderId is null",
    );
  });

  it("COPILOT_DEEP_ANALYSIS handler rejects when question is missing or too short", async () => {
    const handler = getHandler("COPILOT_DEEP_ANALYSIS");
    assert.ok(handler);
    await assert.rejects(
      handler({ jobId: "job-6", userId: "user-1", tenderId: "tender-1", input: {} }),
      /question/i,
      "Expected COPILOT_DEEP_ANALYSIS to reject when input.question is missing",
    );
    await assert.rejects(
      handler({ jobId: "job-7", userId: "user-1", tenderId: "tender-1", input: { question: "hi" } }),
      /question/i,
      "Expected COPILOT_DEEP_ANALYSIS to reject when input.question is < 3 chars",
    );
  });
});
