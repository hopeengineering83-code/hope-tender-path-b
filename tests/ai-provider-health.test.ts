import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  resetProviderHealth,
  recordProviderSuccess,
  recordProviderFailure,
  getProviderRuntimeSnapshot,
  getProviderStateSnapshot,
  restoreProviderState,
} from "../lib/ai-provider-health";

// These exercise the generic health STATE MACHINE, so they use a free-tier
// provider. They previously used "openai", whose availability is now a
// deliberate product answer rather than a neutral example: under zero-paid mode
// a paid provider is BILLING_BLOCKED and therefore never `available`, no matter
// what its health state says. Testing the state machine through it would have
// been testing the money gate instead.
describe("provider health logic", () => {
  beforeEach(() => {
    resetProviderHealth();
    process.env.GROQ_API_KEY = "gsk-test";
    process.env.GEMINI_API_KEY = "AIza-test";
  });

  it("newly initialized provider with key is available", () => {
    assert.equal(getProviderRuntimeSnapshot("groq").available, true);
  });

  it("successful call clears failure state", () => {
    recordProviderFailure("groq", new Error("Rate limit"));
    assert.equal(getProviderRuntimeSnapshot("groq").available, false);
    recordProviderSuccess("groq");
    assert.equal(getProviderRuntimeSnapshot("groq").available, true);
    assert.equal(getProviderRuntimeSnapshot("groq").consecutiveFailures, 0);
  });

  it("multiple failures increase backoff", () => {
    const now = Date.now();
    recordProviderFailure("groq", new Error("Rate limit"));
    const snap1 = getProviderStateSnapshot("groq");
    assert.ok(snap1);
    const cooldown1 = snap1.cooldownUntil! - now;

    recordProviderFailure("groq", new Error("Rate limit"));
    const snap2 = getProviderStateSnapshot("groq");
    assert.ok(snap2);
    const cooldown2 = snap2.cooldownUntil! - now;

    assert.ok(cooldown2 > cooldown1, "Second cooldown should be longer than first");
  });
});

describe("cross-instance restore merging", () => {
  it("DB cooldown remains authoritative when memory says provider is available", () => {
    resetProviderHealth();
    process.env.GROQ_API_KEY = "gsk-test";
    recordProviderSuccess("groq");
    assert.equal(getProviderRuntimeSnapshot("groq").available, true);

    const now = Date.now();
    restoreProviderState("groq", {
      lastSuccessAt: null,
      lastPingSucceededAt: null,
      lastGenerationSucceededAt: null,
      lastAnalysisSucceededAt: null,
      lastFailureAt: now - 1_000,
      lastFailureCategory: "RATE_LIMIT",
      lastFailureMessage: "HTTP 429 Too Many Requests",
      consecutiveFailures: 2,
      cooldownUntil: now + 60_000,
    });

    const runtime = getProviderRuntimeSnapshot("groq");
    assert.equal(runtime.coolingDown, true);
    assert.equal(runtime.rateLimited, true);
    assert.equal(runtime.available, false);
  });
});

describe("/api/ai/health DB restore contract", () => {
  it("restores DB health before response and degrades to a warning instead of crashing", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/api/ai/health/route.ts", "utf8");
    assert.match(source, /restoreProviderHealthBeforeResponse/);
    assert.match(source, /providerHealthRestoreWarning/);
    assert.match(source, /using in-memory provider health for this response/);
  });
});

describe("provider health DB persistence — capability success times", () => {
  it("schema stores per-capability success timestamps", async () => {
    const { readFileSync } = await import("node:fs");
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const model = schema.match(/model ProviderHealthSnapshot \{[\s\S]*?\n\}/)?.[0] ?? "";
    assert.match(model, /lastPingSucceededAt\s+DateTime\?/);
    assert.match(model, /lastAnalysisSucceededAt\s+DateTime\?/);
    assert.match(model, /lastGenerationSucceededAt\s+DateTime\?/);
  });

  it("ships a migration adding the capability columns", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    const path = "prisma/migrations/20260621193000_add_provider_health_capability_times/migration.sql";
    assert.ok(existsSync(path), "migration must exist");
    const sql = readFileSync(path, "utf8");
    assert.match(sql, /lastPingSucceededAt/);
    assert.match(sql, /lastAnalysisSucceededAt/);
    assert.match(sql, /lastGenerationSucceededAt/);
  });

  it("persistAllHealthToDb writes the capability success times (no `as any` casts on restore)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("lib/ai-provider-health-db.ts", "utf8");
    assert.match(src, /lastAnalysisSucceededAt: s\.lastAnalysisSucceededAt/);
    assert.match(src, /lastGenerationSucceededAt: s\.lastGenerationSucceededAt/);
    assert.match(src, /lastPingSucceededAt: s\.lastPingSucceededAt/);
    // Restore reads the real columns, not `(snap as any)`.
    assert.doesNotMatch(src, /\(snap as any\)\.lastAnalysisSucceededAt/);
  });
});

describe("provider health DB persistence order", () => {
  it("derives the persistence iteration order from the canonical registry", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("lib/ai-provider-health-db.ts", "utf8");
    // ALL_PROVIDERS now derives from CANONICAL_AI_PROVIDER_ORDER (single source).
    assert.match(source, /ALL_PROVIDERS[\s\S]*?=\s*CANONICAL_AI_PROVIDER_ORDER/);
    const { CANONICAL_AI_PROVIDER_ORDER } = await import("../lib/ai-provider-registry");
    assert.deepEqual([...CANONICAL_AI_PROVIDER_ORDER], ["gemini", "groq", "mistral", "zai", "openrouter", "cerebras", "openai", "together", "deepseek", "anthropic"]);
  });
});

describe("zero-paid money gate — a key is not permission to spend", () => {
  beforeEach(() => {
    resetProviderHealth();
  });

  it("reports a paid provider as BILLING_BLOCKED even with a valid-looking key", async () => {
    // The behaviour that replaced "openai" as a neutral example above: under
    // zero-paid mode, holding a paid provider's key does not make it available.
    // It is visible, it is reported, and it is never called.
    const { deriveProviderStatus, getProviderRuntimeSnapshot } = await import("../lib/ai-provider-health");
    const saved = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test";
    try {
      assert.equal(deriveProviderStatus("openai"), "BILLING_BLOCKED");
      const snap = getProviderRuntimeSnapshot("openai");
      assert.equal(snap.billingBlocked, true);
      assert.equal(snap.available, false, "a provider that answers only with a bill is not available");
    } finally {
      if (saved === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved;
    }
  });

  it("locks a free provider out for good once it demands payment", async () => {
    // A cooldown is the wrong instrument here: it expires, and the chain tries
    // again, and "this account has no money" has not changed. Ten minutes later
    // it spends another attempt discovering the same thing.
    const {
      recordProviderFailure: record,
      isBillingLockedOut,
      clearBillingLockout,
      deriveProviderStatus,
    } = await import("../lib/ai-provider-health");
    const saved = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = "gsk-test";
    try {
      assert.equal(isBillingLockedOut("groq"), false);
      record("groq", new Error("HTTP 402: You have exceeded your free tier quota, please add a payment method"));
      assert.equal(isBillingLockedOut("groq"), true);
      assert.equal(deriveProviderStatus("groq"), "BILLING_BLOCKED");
      // Only an operator clears it, never a timer.
      clearBillingLockout("groq");
      assert.equal(isBillingLockedOut("groq"), false);
    } finally {
      if (saved === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = saved;
      resetProviderHealth();
    }
  });
});
