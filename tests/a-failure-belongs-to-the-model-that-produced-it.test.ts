import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  isProviderCooledDown,
  recordProviderFailure,
  recordProviderSuccess,
  resetProviderHealth,
  providerConfigFingerprint,
  clearFailureStateOrphanedByConfigChange,
  getProviderHealth,
} from "../lib/ai-provider-health";

/**
 * THE DEFECT, read off the owner's live Preview.
 * ---------------------------------------------
 * Mistral is configured with `mistral-large-latest` and answers:
 *
 *   HTTP 403 {"message":"This model is not available in your subscription
 *             tier","type":"tier_not_allowed","code":"1910"}
 *
 * That records an AUTH failure. AUTH's base cooldown is 5 minutes, and the
 * consecutiveFailures backoff multiplies it by up to 16 — so after a handful of
 * runs the provider is suppressed for over an hour. Both the cooldown and the
 * failure count persist to ProviderHealthSnapshot and are restored on every
 * cold start.
 *
 * On 2026-09-15 the owner's real extraction (AiJob 5c44d156) contacted only
 * gemini and zai out of ten configured providers. The other eight were skipped,
 * most of them cooling down from failures earned earlier that day.
 *
 * Now suppose the operator does the obvious thing and switches Mistral to
 * `mistral-small-latest`, which their tier does allow. Before this fix the
 * provider stayed skipped for the rest of the backoff, because the state
 * suppressing it was earned by a model no longer in use. Their fix appears not
 * to work — and the natural next conclusion is that the provider needs paying
 * for, which is exactly the wrong conclusion.
 *
 * The rule: a failure is evidence about a (provider, model) pair.
 */

const withModels = (analysis: string, proposal: string, fast: string) => ({
  NODE_ENV: "test",
  PATH: process.env.PATH,
  MISTRAL_API_KEY: "test-key",
  MISTRAL_ANALYSIS_MODEL: analysis,
  MISTRAL_PROPOSAL_MODEL: proposal,
  MISTRAL_FAST_MODEL: fast,
}) as NodeJS.ProcessEnv;

const TIER_BLOCKED = withModels("mistral-large-latest", "mistral-large-latest", "mistral-small-latest");
const TIER_ALLOWED = withModels("mistral-small-latest", "mistral-small-latest", "mistral-small-latest");

describe("a failure belongs to the model that produced it", () => {
  beforeEach(() => resetProviderHealth());

  it("the fingerprint carries model identifiers and nothing secret", () => {
    const fingerprint = providerConfigFingerprint("mistral", TIER_BLOCKED);
    assert.match(fingerprint, /mistral-large-latest/);
    // It is persisted and surfaced, so it must never carry a credential.
    assert.ok(!fingerprint.includes("test-key"), "fingerprint leaked the API key");
    assert.ok(!/api[_-]?key/i.test(fingerprint), "fingerprint mentions a key field");
    assert.ok(!fingerprint.includes("http"), "fingerprint leaked a base URL");
  });

  it("distinguishes one model set from another", () => {
    assert.notEqual(
      providerConfigFingerprint("mistral", TIER_BLOCKED),
      providerConfigFingerprint("mistral", TIER_ALLOWED),
    );
  });

  it("a tier-blocked model does not suppress the model that replaced it", () => {
    const previousEnv = process.env;
    try {
      // The real 403, under the model that produced it.
      process.env = TIER_BLOCKED;
      recordProviderFailure("mistral", new Error('HTTP 403 {"message":"This model is not available in your subscription tier","code":"1910"}'));
      assert.equal(isProviderCooledDown("mistral"), true, "precondition: the failure must impose a cooldown");

      // The operator switches to a model their tier allows.
      process.env = TIER_ALLOWED;
      assert.equal(
        isProviderCooledDown("mistral"),
        false,
        "a cooldown earned by a model no longer configured must not suppress its replacement",
      );

      // And the compounding backoff does not carry over either, or the next
      // unrelated failure would start from a punitive multiplier.
      assert.equal(getProviderHealth("mistral").consecutiveFailures, 0);
      assert.equal(getProviderHealth("mistral").lastFailureCategory, null);
    } finally {
      process.env = previousEnv;
    }
  });

  it("keeps the cooldown while the configuration is unchanged", () => {
    const previousEnv = process.env;
    try {
      process.env = TIER_BLOCKED;
      recordProviderFailure("mistral", new Error("HTTP 403 tier_not_allowed"));
      assert.equal(
        isProviderCooledDown("mistral"),
        true,
        "the same configuration that failed must still be cooling down — this is not an escape hatch",
      );
      assert.equal(clearFailureStateOrphanedByConfigChange("mistral", TIER_BLOCKED), false);
    } finally {
      process.env = previousEnv;
    }
  });

  it("never discards proven success history", () => {
    const previousEnv = process.env;
    try {
      process.env = TIER_BLOCKED;
      recordProviderSuccess("mistral");
      recordProviderFailure("mistral", new Error("HTTP 403 tier_not_allowed"));
      const before = getProviderHealth("mistral").lastSuccessAt;
      assert.ok(before, "precondition: a success must be recorded");

      process.env = TIER_ALLOWED;
      clearFailureStateOrphanedByConfigChange("mistral", TIER_ALLOWED);
      assert.equal(
        getProviderHealth("mistral").lastSuccessAt,
        before,
        "the provider really did answer once; a config change does not unmake that",
      );
    } finally {
      process.env = previousEnv;
    }
  });

  it("a row with no recorded fingerprint behaves exactly as before", () => {
    const previousEnv = process.env;
    try {
      // Rows written before this column existed carry null. They must not be
      // read as "mismatched" — that would clear every legacy cooldown at once.
      process.env = TIER_BLOCKED;
      recordProviderFailure("mistral", new Error("HTTP 429 rate limit"));
      const s = getProviderHealth("mistral");
      assert.ok(s.cooldownUntil, "precondition");
      assert.equal(clearFailureStateOrphanedByConfigChange("gemini", TIER_BLOCKED), false, "a provider with no state clears nothing");
    } finally {
      process.env = previousEnv;
    }
  });
});
