// ─── The zero-paid scenario, end to end ──────────────────────────────────────
//
// This is the exact configuration this deployment runs, expressed as a test:
//
//   Gemini     → works
//   Groq       → works
//   Mistral    → works
//   Z.ai       → temporarily 429 / overloaded
//   Cerebras   → 402, free-tier quota exhausted, payment method required
//   OpenAI     → insufficient paid quota
//   Together   → invalid key
//   DeepSeek   → insufficient balance
//   OpenRouter → not configured
//
// The requirement is that AI Analyze COMPLETES on the first usable free
// provider, rather than the chain failing as a whole. Two things had to be true
// for that, and neither was:
//
//   1. A provider that demands payment must be skipped without consuming an
//      attempt and without stalling the chain. Cerebras' 402 was classified as
//      RATE_LIMIT (the classifier tested the word "quota" before it tested
//      "payment required"), so it was retried on a cooldown timer forever.
//   2. A paid provider must not be contacted at all. Exclusion depended on its
//      key being unset, so an account that had once used OpenAI kept a live
//      path to a billable endpoint.
//
// Every fetch here is mocked. No real provider is contacted, and the tests
// assert on exactly which endpoints were reached — the strongest available
// statement that nothing was charged.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateWithFallback, NoAiProviderReadyError } from "../lib/ai";
import { resetProviderHealth, deriveProviderStatus, isBillingLockedOut } from "../lib/ai-provider-health";
import { getAutomaticProviderOrder, PAID_ACCESS_PROVIDERS } from "../lib/ai-provider-registry";

const ALL_KEYS = [
  "GEMINI_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "ZAI_API_KEY",
  "OPENROUTER_API_KEY", "OPENROUTER_PROPOSAL_MODEL", "CEREBRAS_API_KEY",
  "OPENAI_API_KEY", "TOGETHER_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY",
];

let saved: Record<string, string | undefined> = {};
let realFetch: typeof globalThis.fetch;

/** The failure each provider is configured to produce, in its own words. */
const PROVIDER_RESPONSES: Record<string, { status: number; body: unknown }> = {
  "api.groq.com": { status: 200, body: { choices: [{ message: { content: "GROQ RESULT" } }] } },
  "api.mistral.ai": { status: 200, body: { choices: [{ message: { content: "MISTRAL RESULT" } }] } },
  // Z.ai: a genuine, transient rate limit. Must NOT be treated as billing.
  "api.z.ai": { status: 429, body: { error: { message: "Rate limit exceeded, requests per minute" } } },
  // Cerebras: 402. The wording deliberately contains "quota" — this is the
  // exact string that used to be misfiled as RATE_LIMIT.
  "api.cerebras.ai": { status: 402, body: { error: { message: "You have exceeded your free tier quota. Please add a payment method." } } },
  // OpenAI: reports an unpayable account as 429, not 402.
  "api.openai.com": { status: 429, body: { error: { code: "insufficient_quota", message: "You exceeded your current quota, please check your plan and billing details." } } },
  "api.together.xyz": { status: 401, body: { error: { message: "Invalid API key provided" } } },
  "api.deepseek.com": { status: 402, body: { error: { message: "Insufficient Balance" } } },
  "openrouter.ai": { status: 200, body: { choices: [{ message: { content: "OPENROUTER RESULT" } }] } },
};

function installScenarioFetch(): { urls: () => string[] } {
  const urls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as { url: string }).url;
    urls.push(url);
    const match = Object.keys(PROVIDER_RESPONSES).find((host) => url.includes(host));
    const response = match
      ? PROVIDER_RESPONSES[match]
      : { status: 500, body: { error: { message: "unexpected host" } } };
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      text: async () => JSON.stringify(response.body),
      json: async () => response.body,
    } as Response;
  }) as typeof globalThis.fetch;
  return { urls: () => urls };
}

/** Configure the exact scenario above. */
function applyScenario(opts?: { withGemini?: boolean }) {
  if (opts?.withGemini) process.env.GEMINI_API_KEY = "AIzaScenarioKey123456789012345678901";
  process.env.GROQ_API_KEY = "gsk-scenario";
  process.env.MISTRAL_API_KEY = "mistral-scenario";
  process.env.ZAI_API_KEY = "zai-scenario";
  process.env.CEREBRAS_API_KEY = "csk-scenario";
  process.env.OPENAI_API_KEY = "sk-scenario";
  process.env.TOGETHER_API_KEY = "together-scenario";
  process.env.DEEPSEEK_API_KEY = "dsk-scenario";
  process.env.ANTHROPIC_API_KEY = "sk-ant-scenario";
  // OpenRouter: key present but no model → conditional-free unverified.
  process.env.OPENROUTER_API_KEY = "sk-or-scenario";
}

beforeEach(() => {
  saved = {};
  for (const key of ALL_KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
  realFetch = globalThis.fetch;
  resetProviderHealth();
});

afterEach(() => {
  for (const key of ALL_KEYS) {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
  globalThis.fetch = realFetch;
  resetProviderHealth();
});

describe("ZERO-PAID scenario — AI Analyze completes on the first usable free provider", () => {
  it("succeeds through Groq when Gemini is unconfigured, and never contacts a paid endpoint", async () => {
    applyScenario();
    const scenario = installScenarioFetch();

    const result = await generateWithFallback("analyse this tender", { useCase: "extraction" });
    assert.equal(result, "GROQ RESULT");

    // The whole point: five providers hold live keys and not one was contacted.
    const paidHosts = ["api.cerebras.ai", "api.openai.com", "api.together.xyz", "api.deepseek.com", "api.anthropic.com"];
    for (const host of paidHosts) {
      assert.ok(
        !scenario.urls().some((url) => url.includes(host)),
        `${host} must never be contacted — it holds a key and requires payment`,
      );
    }
  });

  it("falls through Z.ai's rate limit to the next free provider rather than failing the chain", async () => {
    // Z.ai first: the free chain must survive one of its own members being
    // temporarily unavailable.
    applyScenario();
    delete process.env.GROQ_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    process.env.OPENROUTER_PROPOSAL_MODEL = "meta-llama/llama-3.3-70b-instruct:free";
    const scenario = installScenarioFetch();

    const result = await generateWithFallback("analyse this tender", { useCase: "extraction" });
    assert.equal(result, "OPENROUTER RESULT", "a 429 on Z.ai must not end the chain");
    assert.ok(scenario.urls().some((url) => url.includes("api.z.ai")), "Z.ai must actually have been tried");
    assert.equal(deriveProviderStatus("zai"), "RATE_LIMITED");
    assert.equal(isBillingLockedOut("zai"), false, "a transient rate limit is not a billing block");
  });

  it("classifies each provider's refusal correctly, so the operator sees the real cause", async () => {
    // Drives the classifier through the scenario's exact wire messages. The
    // three that matter most all mention quota or limits, and all three mean
    // different things.
    const { classifyProviderError } = await import("../lib/ai-provider-classification");

    assert.equal(
      classifyProviderError(new Error('HTTP 402: {"error":{"message":"You have exceeded your free tier quota. Please add a payment method."}}')),
      "BILLING",
      "Cerebras 402 is BILLING — it was previously RATE_LIMIT because the classifier saw 'quota' first",
    );
    assert.equal(
      classifyProviderError(new Error('HTTP 429: {"error":{"code":"insufficient_quota","message":"You exceeded your current quota, please check your plan and billing details."}}')),
      "BILLING",
      "OpenAI reports an unpayable account as 429; the phrase is authoritative, not the status",
    );
    assert.equal(
      classifyProviderError(new Error('HTTP 402: {"error":{"message":"Insufficient Balance"}}')),
      "BILLING",
    );
    assert.equal(
      classifyProviderError(new Error('HTTP 401: {"error":{"message":"Invalid API key provided"}}')),
      "AUTH",
    );
    assert.equal(
      classifyProviderError(new Error('HTTP 429: {"error":{"message":"Rate limit exceeded, requests per minute"}}')),
      "RATE_LIMIT",
      "a real per-minute cap stays RATE_LIMIT",
    );
    assert.equal(
      classifyProviderError(new Error("429 RESOURCE_EXHAUSTED: Quota exceeded for quota metric 'Generate Content API requests per minute'")),
      "RATE_LIMIT",
      "Gemini's free-tier cap says 'quota' but is genuinely transient — it must not be called BILLING",
    );
    assert.equal(
      classifyProviderError(new Error("The model is currently overloaded, please retry shortly")),
      "PROVIDER_OVERLOAD",
      "capacity is neither our usage nor their bug",
    );
  });

  it("reports every paid provider as BILLING_BLOCKED while their keys sit configured", () => {
    applyScenario();
    for (const provider of PAID_ACCESS_PROVIDERS) {
      assert.equal(
        deriveProviderStatus(provider),
        "BILLING_BLOCKED",
        `${provider} holds a key and must be shown as deliberately excluded, not as unconfigured or healthy`,
      );
    }
  });

  it("keeps the automatic chain to the free providers, in the required priority order", () => {
    applyScenario({ withGemini: true });
    assert.deepEqual(
      [...getAutomaticProviderOrder()],
      ["gemini", "groq", "mistral", "zai", "openrouter"],
    );
  });

  it("stops re-attempting a provider that has demanded payment", async () => {
    // Without the lockout, Cerebras' 402 returns on a ten-minute timer forever,
    // spending an attempt each round — and on an account with a card attached,
    // each of those attempts is a chance to be charged.
    const { recordProviderFailure } = await import("../lib/ai-provider-health");
    applyScenario();
    recordProviderFailure("cerebras", new Error("HTTP 402: free tier quota exhausted, add a payment method"));
    assert.equal(isBillingLockedOut("cerebras"), true);

    const scenario = installScenarioFetch();
    await generateWithFallback("analyse this tender", { useCase: "extraction" });
    assert.ok(!scenario.urls().some((url) => url.includes("api.cerebras.ai")));
  });

  it("says what to do when the only configured keys are for paid providers", async () => {
    // The likeliest state for an account migrating off paid providers, and the
    // one where a bare "all providers exhausted" is least useful.
    process.env.OPENAI_API_KEY = "sk-scenario";
    process.env.DEEPSEEK_API_KEY = "dsk-scenario";
    installScenarioFetch();

    await assert.rejects(
      () => generateWithFallback("analyse this tender", { useCase: "extraction" }),
      (err: unknown) => {
        assert.ok(err instanceof NoAiProviderReadyError);
        const details = (err as NoAiProviderReadyError).failureDetails.join(" ");
        assert.match(details, /openai, deepseek are configured but require paid access/);
        assert.match(details, /Set GEMINI_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY or ZAI_API_KEY/);
        return true;
      },
    );
  });
});

// ─── Every operator-facing surface must agree about what an error means ──────
//
// Fixing the routing classifier is only half the job: three separate reporting
// classifiers each decided independently, and all three mis-sorted billing. The
// operator reads THOSE, so a routing fix nobody can see is not a fix.
describe("all failure classifiers agree with the single authority", () => {
  const CEREBRAS_402 = 'HTTP 402: {"error":{"message":"You have exceeded your free tier quota. Please add a payment method."}}';
  const OPENAI_429 = 'HTTP 429: {"error":{"code":"insufficient_quota","message":"You exceeded your current quota, please check your plan and billing details."}}';
  const GEMINI_429 = "429 RESOURCE_EXHAUSTED: Quota exceeded for quota metric 'Generate Content API requests per minute'";

  it("safe-diagnostics calls a payment demand BILLING_BLOCKED, not RATE_LIMITED", async () => {
    // Its ladder tested `429` before billing, so OpenAI — which reports an
    // unpayable account as 429 — came out as a rate limit, and Cerebras' 402
    // matched no branch at all and fell through to UNKNOWN.
    const { toSafeAiFailureCategory } = await import("../lib/engine/analysis/safe-diagnostics");
    assert.equal(toSafeAiFailureCategory(new Error(CEREBRAS_402)), "BILLING_BLOCKED");
    assert.equal(toSafeAiFailureCategory(new Error(OPENAI_429)), "BILLING_BLOCKED");
    assert.equal(toSafeAiFailureCategory(new Error(GEMINI_429)), "RATE_LIMITED");
  });

  it("fallback diagnostics stop telling the operator to wait for a bill to clear", async () => {
    const { buildAnalysisFallbackDiagnostics } = await import("../lib/engine/analysis-fallback-diagnostics");
    const billing = buildAnalysisFallbackDiagnostics(CEREBRAS_402);
    assert.equal(billing.category, "BILLING_BLOCKED");
    assert.equal(billing.retryRecommended, false, "waiting cannot clear a payment demand");
    assert.match(billing.nextAction, /GEMINI_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY or ZAI_API_KEY/);
    assert.match(billing.nextAction, /Waiting will not clear this/);

    // A genuine rate limit keeps the advice that actually works.
    const rateLimited = buildAnalysisFallbackDiagnostics(GEMINI_429);
    assert.equal(rateLimited.category, "RATE_LIMIT");
    assert.equal(rateLimited.retryRecommended, true);
  });

  it("the no-provider advice names free keys, never paid ones", async () => {
    // It used to list all ten keys and state "All 10 providers are automatic",
    // so an operator following it would reach for whichever key they had —
    // which is how a paid provider gets configured on a zero-paid deployment.
    const { buildAnalysisFallbackDiagnostics } = await import("../lib/engine/analysis-fallback-diagnostics");
    const none = buildAnalysisFallbackDiagnostics("No AI provider configured");
    assert.equal(none.category, "NO_PROVIDER_CONFIGURED");
    assert.doesNotMatch(none.nextAction, /Set any AI provider key/);
    assert.match(none.nextAction, /GEMINI_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY or ZAI_API_KEY/);
    assert.match(none.nextAction, /require paid access and are excluded/);
  });

  it("an exhausted quota is BILLING in the engine store, not a 60-second cooldown", async () => {
    // Mapped to RATE_LIMIT "for in-memory tracking parity", which made the two
    // indistinguishable exactly where the difference matters.
    const source = readFileSync("lib/engine/provider-health-store.ts", "utf8");
    assert.match(source, /QUOTA_EXHAUSTED: "BILLING"/);
    assert.doesNotMatch(source, /QUOTA_EXHAUSTED: "RATE_LIMIT"/);
  });

  it("fallback diagnostics use the shared redactor, not a fourth private copy", async () => {
    // The three patterns it carried covered sk-, AIza and Bearer — missing
    // Groq's gsk_, Cerebras' csk_, DeepSeek's dsk- and Google's AQ format. This
    // string is operator-facing, so the gap showed real keys to whoever read it.
    const source = readFileSync("lib/engine/analysis-fallback-diagnostics.ts", "utf8");
    assert.match(source, /redactSecrets/);
    assert.doesNotMatch(source, /AIza\[A-Za-z0-9_-\]\{30,\}/);

    const { buildAnalysisFallbackDiagnostics } = await import("../lib/engine/analysis-fallback-diagnostics");
    const groqKey = "gsk_" + "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0";
    const out = buildAnalysisFallbackDiagnostics(`Request failed with ${groqKey}`);
    assert.ok(!out.message.includes(groqKey), "a Groq key must not survive into operator-facing text");
  });
});
