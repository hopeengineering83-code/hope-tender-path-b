import { test } from "node:test";
import assert from "node:assert";
import { AiAnalyzeRunner } from "../lib/ai-analyze/runner";
import { toSafeAiFailureCategory } from "../lib/engine/analysis/safe-diagnostics";

test("AiAnalyzeRunner exports required methods", () => {
  assert.strictEqual(typeof AiAnalyzeRunner.startOrResume, "function");
  assert.strictEqual(typeof AiAnalyzeRunner.runNextChunk, "function");
  assert.strictEqual(typeof AiAnalyzeRunner.finalize, "function");
});

test("toSafeAiFailureCategory maps errors correctly", () => {
  assert.strictEqual(toSafeAiFailureCategory(new Error("Rate limit exceeded")), "RATE_LIMITED");
  assert.strictEqual(toSafeAiFailureCategory(new Error("429 Too Many Requests")), "RATE_LIMITED");
  assert.strictEqual(toSafeAiFailureCategory(new Error("API key missing")), "NOT_CONFIGURED");
  assert.strictEqual(toSafeAiFailureCategory(new Error("Invalid API key")), "UNAUTHORIZED");
  assert.strictEqual(toSafeAiFailureCategory(new Error("Quota exceeded")), "BILLING_BLOCKED");
  assert.strictEqual(toSafeAiFailureCategory(new Error("model_not_found")), "MODEL_UNAVAILABLE");
  assert.strictEqual(toSafeAiFailureCategory(new Error("timeout")), "TIMEOUT");
  assert.strictEqual(toSafeAiFailureCategory(new Error("fetch failed")), "NETWORK_ERROR");
  assert.strictEqual(toSafeAiFailureCategory(new Error("All providers exhausted")), "PROVIDER_EXHAUSTED");
  assert.strictEqual(toSafeAiFailureCategory(new Error("Unknown something")), "UNKNOWN");
});
