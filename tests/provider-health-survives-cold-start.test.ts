// ─── Provider health across serverless instances ─────────────────────────────
//
// Every piece of provider health lives in a module-level Map, and on Vercel a
// module-level Map is one lambda. Whatever one instance learns, the next cold
// start has to relearn — unless it was persisted and restored. Three things
// were not surviving that trip, and all three made the system quieter about
// facts it had already established:
//
//   1. An expired cooldown discarded the WHOLE row on restore, including the
//      capability timestamps. A provider that had completed a real AI Analyze
//      and later hit one transient rate limit came back as never-verified.
//   2. Ping-only state was never written at all, because the "has anything
//      happened?" test predated the capability timestamps.
//   3. The billing lockout was a separate Map that was neither persisted nor
//      restored, so each cold start rediscovered a payment demand by spending
//      another attempt on it.
//
// These exercise the real restore/persist logic against the real state module.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  resetProviderHealth,
  restoreProviderState,
  getProviderStateSnapshot,
  deriveProviderStatus,
  isBillingLockedOut,
  recordProviderPingSuccess,
  recordProviderAnalysisSuccess,
  recordProviderFailure,
} from "../lib/ai-provider-health";

const MINUTE = 60_000;

let savedKeys: Record<string, string | undefined> = {};
const KEYS = ["GROQ_API_KEY", "GEMINI_API_KEY", "MISTRAL_API_KEY", "ZAI_API_KEY"];

beforeEach(() => {
  savedKeys = {};
  for (const k of KEYS) savedKeys[k] = process.env[k];
  resetProviderHealth();
});
afterEach(() => {
  for (const k of KEYS) {
    if (savedKeys[k] === undefined) delete process.env[k]; else process.env[k] = savedKeys[k];
  }
  resetProviderHealth();
});

describe("a proven capability survives a cold start", () => {
  it("keeps ANALYSIS_VERIFIED when the restored row's cooldown has expired", () => {
    // The shape the old code threw away: analysis succeeded, then a transient
    // failure imposed a cooldown, and by the time the next instance started the
    // cooldown had passed. The provider is fine. It must not read as unverified.
    process.env.GROQ_API_KEY = "gsk-test";
    const now = Date.now();
    restoreProviderState("groq", {
      lastSuccessAt: now - 30 * MINUTE,
      lastPingSucceededAt: null,
      lastGenerationSucceededAt: null,
      lastAnalysisSucceededAt: now - 30 * MINUTE,
      lastFailureAt: now - 20 * MINUTE,
      lastFailureCategory: "RATE_LIMIT",
      lastFailureMessage: "rate limited",
      consecutiveFailures: 1,
      cooldownUntil: null, // expired, dropped by the restore path
    });
    assert.equal(deriveProviderStatus("groq"), "ANALYSIS_VERIFIED");
  });

  it("still honours a cooldown that has NOT expired", () => {
    // The other direction: dropping expired cooldowns must not drop live ones.
    process.env.GROQ_API_KEY = "gsk-test";
    const now = Date.now();
    restoreProviderState("groq", {
      lastSuccessAt: now - 30 * MINUTE,
      lastPingSucceededAt: null,
      lastGenerationSucceededAt: null,
      lastAnalysisSucceededAt: now - 30 * MINUTE,
      lastFailureAt: now - 10_000,
      lastFailureCategory: "RATE_LIMIT",
      lastFailureMessage: "rate limited",
      consecutiveFailures: 1,
      cooldownUntil: now + 5 * MINUTE,
    });
    assert.equal(deriveProviderStatus("groq"), "RATE_LIMITED");
  });
});

describe("ping-only state is real state", () => {
  it("a connectivity-verified provider has something worth persisting", () => {
    // recordProviderPingSuccess sets lastPingSucceededAt and nothing else, so a
    // persist guard that tested only lastSuccessAt/lastFailureAt considered this
    // provider blank and skipped the write.
    process.env.MISTRAL_API_KEY = "mistral-test";
    recordProviderPingSuccess("mistral");
    const snap = getProviderStateSnapshot("mistral");
    assert.ok(snap);
    assert.equal(snap!.lastSuccessAt, null, "ping deliberately does not set the generic success time");
    assert.ok(snap!.lastPingSucceededAt, "…so the capability timestamp is the only evidence it happened");
    assert.equal(deriveProviderStatus("mistral"), "CONNECTIVITY_VERIFIED");
  });

  it("the persist guard counts capability timestamps as state", () => {
    const source = require("node:fs").readFileSync("lib/ai-provider-health-db.ts", "utf8");
    assert.match(source, /s\.lastPingSucceededAt/);
    assert.match(source, /s\.lastAnalysisSucceededAt/);
    assert.match(source, /s\.lastGenerationSucceededAt/);
  });
});

describe("a payment refusal parks a provider, it does not remove one", () => {
  // This block used to pin the opposite rule: a 402 removed the provider from
  // the automatic chain for the life of the process, cleared only by an
  // operator and re-armed on every cold start from the persisted BILLING
  // category. That was a cost policy, and the owner's provider directive has
  // none — all ten providers stay in the chain, and a billing refusal is one
  // more way a single attempt can fail.
  //
  // The tests were rewritten rather than deleted because the behaviour they
  // guarded still needs guarding; it is the RULE that changed. What must remain
  // true is that a refusing provider never stalls a request (it is skipped
  // without spending an attempt while cooling down) and never disappears
  // silently (it still reports BILLING_BLOCKED).

  it("reports BILLING_BLOCKED while the refusal is still cooling down", () => {
    process.env.ZAI_API_KEY = "zai-test";
    assert.equal(isBillingLockedOut("zai"), false);
    recordProviderFailure("zai", new Error("HTTP 402: insufficient balance"));
    assert.equal(isBillingLockedOut("zai"), true);
    assert.equal(deriveProviderStatus("zai"), "BILLING_BLOCKED");
  });

  it("lets the provider back into the chain once the cooldown expires", () => {
    // The property the old permanent lockout removed. A provider that refused
    // payment an hour ago may have been topped up since; refusing to ever ask
    // again is a decision this application is not entitled to make.
    process.env.ZAI_API_KEY = "zai-test";
    recordProviderFailure("zai", new Error("HTTP 402: insufficient balance"));
    assert.equal(isBillingLockedOut("zai"), true, "still parked immediately after the refusal");

    const snap = getProviderStateSnapshot("zai")!;
    restoreProviderState("zai", { ...snap, cooldownUntil: Date.now() - MINUTE });

    assert.equal(isBillingLockedOut("zai"), false, "the refusal must expire like any other failure");
    assert.notEqual(
      deriveProviderStatus("zai"),
      "BILLING_BLOCKED",
      "an expired billing cooldown must not keep reporting the provider as blocked",
    );
  });

  it("carries the refusal across a cold start through the cooldown, with no second store", () => {
    // The old design needed its own Map, its own restore call, and its own
    // persistence reasoning. The cooldown already crosses cold starts, so the
    // predicate is derived from it and there is nothing separate to keep in
    // step — one fact, one place.
    const source = require("node:fs").readFileSync("lib/ai-provider-health-db.ts", "utf8");
    assert.ok(
      !source.includes("restoreBillingLockout"),
      "restoring a billing refusal must not need a mechanism of its own",
    );
    assert.match(source, /cooldownUntil/, "the cooldown is what carries it across a cold start");
  });

  it("keeps a diagnostic billing result out of workload routing", () => {
    // Billing was the one diagnostic observation allowed to cross into routing,
    // because a locked-out provider had to be locked out everywhere. With no
    // lockout, that exception has nothing to justify it, and removing it
    // restores what this store exists for: running a diagnostic never changes
    // how real work is routed.
    const source = require("node:fs").readFileSync("lib/ai-provider-health.ts", "utf8");
    assert.ok(
      !/billingLockout/.test(source),
      "no separate billing lockout store may remain",
    );
  });
});

describe("a real AI Analyze proves ANALYSIS, and says so", () => {
  it("callProvider records the analysis capability for an extraction call", () => {
    // Every branch of callProvider's switch records a generic success, which the
    // health state files as generation-verified. For an extraction call that is
    // the wrong label, and it left ANALYSIS_VERIFIED reachable only through the
    // operator diagnostic — a deployment could run AI Analyze successfully all
    // day and never report an analysis-verified provider.
    const source = require("node:fs").readFileSync("lib/ai.ts", "utf8");
    assert.match(source, /=== "extraction"\)\s*\{\s*\n\s*recordProviderAnalysisSuccess\(name\);/);
  });

  it("ANALYSIS_VERIFIED is what makes a provider usable for AI Analyze", () => {
    process.env.GEMINI_API_KEY = "AIzaTestKey1234567890123456789012345";
    recordProviderAnalysisSuccess("gemini");
    assert.equal(deriveProviderStatus("gemini"), "ANALYSIS_VERIFIED");
    const { isProviderAnalysisUsable } = require("../lib/ai-provider-health");
    assert.equal(isProviderAnalysisUsable("gemini"), true);
  });
});
