import { test } from "node:test";
import assert from "node:assert";
import { toSafeAiFailureCategory } from "../lib/engine/analysis/safe-diagnostics";

test("toSafeAiFailureCategory maps errors correctly", () => {
  assert.strictEqual(toSafeAiFailureCategory(new Error("Rate limit exceeded")), "RATE_LIMITED");
  assert.strictEqual(toSafeAiFailureCategory(new Error("429 Too Many Requests")), "RATE_LIMITED");
  assert.strictEqual(toSafeAiFailureCategory(new Error("API key missing")), "NOT_CONFIGURED");
  assert.strictEqual(toSafeAiFailureCategory(new Error("Invalid API key")), "UNAUTHORIZED");
  // Bare "Quota exceeded" is RATE_LIMITED, not BILLING_BLOCKED. This expectation
  // used to be the other way round, and it enshrined a real hazard: Gemini's
  // free-tier cap reports literally "Quota exceeded for quota metric
  // '…requests per minute'", so reading the bare phrase as unpayable would
  // billing-lock the rank-1 free provider out of the chain on an ordinary
  // throughput limit. Billing is decided by billing-SPECIFIC phrasing instead,
  // asserted immediately below.
  assert.strictEqual(toSafeAiFailureCategory(new Error("Quota exceeded")), "RATE_LIMITED");
  assert.strictEqual(toSafeAiFailureCategory(new Error("You exceeded your current quota, please check your plan and billing details.")), "BILLING_BLOCKED");
  assert.strictEqual(toSafeAiFailureCategory(new Error("HTTP 402 Payment Required")), "BILLING_BLOCKED");
  assert.strictEqual(toSafeAiFailureCategory(new Error("Insufficient Balance")), "BILLING_BLOCKED");
  assert.strictEqual(toSafeAiFailureCategory(new Error("The model is currently overloaded")), "PROVIDER_OVERLOAD");
  assert.strictEqual(toSafeAiFailureCategory(new Error("model_not_found")), "MODEL_UNAVAILABLE");
  assert.strictEqual(toSafeAiFailureCategory(new Error("timeout")), "TIMEOUT");
  assert.strictEqual(toSafeAiFailureCategory(new Error("fetch failed")), "NETWORK_ERROR");
  assert.strictEqual(toSafeAiFailureCategory(new Error("All providers exhausted")), "PROVIDER_EXHAUSTED");
  assert.strictEqual(toSafeAiFailureCategory(new Error("Unknown something")), "UNKNOWN");
});
