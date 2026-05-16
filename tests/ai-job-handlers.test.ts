// Tests for the AI job handler registry (PR XX-ASYNC).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { getHandler, supportedJobTypes } from "../lib/ai-job-handlers";

describe("ai-job-handlers registry", () => {
  it("ENGINE_RUN handler is registered", () => {
    const handler = getHandler("ENGINE_RUN");
    assert.ok(handler, "Expected ENGINE_RUN handler to be registered");
    assert.equal(typeof handler, "function");
  });

  it("returns null for unregistered job types", () => {
    // These job types are valid JobType values but have no handler yet —
    // the worker will mark them FAILED rather than hang.
    assert.equal(getHandler("PROPOSAL_GENERATION"), null);
    assert.equal(getHandler("AI_REMATCH"), null);
    assert.equal(getHandler("EVALUATOR_SIM"), null);
    assert.equal(getHandler("COPILOT_DEEP_ANALYSIS"), null);
    assert.equal(getHandler("PROFILE_FACT_EXTRACTION"), null);
  });

  it("supportedJobTypes lists ENGINE_RUN", () => {
    const types = supportedJobTypes();
    assert.ok(types.includes("ENGINE_RUN"), `Expected ENGINE_RUN in supportedJobTypes(), got: ${types.join(", ")}`);
  });

  it("ENGINE_RUN handler throws when tenderId is missing", async () => {
    const handler = getHandler("ENGINE_RUN");
    assert.ok(handler);
    await assert.rejects(
      handler({ jobId: "job-1", userId: "user-1", tenderId: null, input: {} }),
      /tenderId/i,
      "Expected ENGINE_RUN to reject when tenderId is null",
    );
  });
});
