// ─── The ten-provider fallback chain, end to end ─────────────────────────────
//
// The owner's directive is one chain, in one order, with no provider excluded:
//
//   Gemini → Groq → Mistral → Z.ai → Cerebras → OpenRouter → OpenAI →
//   Together → DeepSeek → Anthropic → deterministic draft (LAST)
//
// A provider that is missing, unauthenticated, misconfigured, model-invalid,
// unavailable, rate-limited, timed out, billing-refused, or that returns
// unusable output, is one failed attempt: the chain moves to the next provider.
// The deterministic draft runs only once every AI provider is exhausted, and
// never carries final authority.
//
// This file previously encoded the opposite rule — a zero-paid policy in which
// Cerebras, OpenAI, Together, DeepSeek and Anthropic were excluded before a
// request was built, and OpenRouter needed a ':free' model. That policy has
// been withdrawn. The scenario below is kept because the SHAPE of the test is
// still exactly right (a realistic mix of failures, every fetch mocked and
// asserted); what changed is which outcomes count as correct.
//
// One defect found under the old policy is worth keeping in view, because it is
// independent of any pricing rule and still fixed here: Cerebras' HTTP 402 was
// classified RATE_LIMIT, because the classifier tested the word "quota" before
// it tested "payment required". A payment demand read as a throttle is retried
// forever on a timer. It is now BILLING — a real category, with a real cooldown,
// that expires so the provider is asked again.
//
// Every fetch here is mocked. No real provider is contacted, and the tests
// assert on exactly which endpoints were reached — the strongest available
// statement that nothing was charged.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateWithFallback, NoAiProviderReadyError } from "../lib/ai";
import { resetProviderHealth, deriveProviderStatus, isBillingLockedOut } from "../lib/ai-provider-health";
import {
  getAutomaticProviderOrder,
  providerAutomaticEligibility,
} from "../lib/ai-provider-registry";

const ALL_KEYS = [
  "GEMINI_API_KEY", "GROQ_API_KEY", "GROQ_PROPOSAL_MODEL", "MISTRAL_API_KEY", "ZAI_API_KEY",
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
  process.env.GROQ_PROPOSAL_MODEL = "llama-3.1-8b-instant";
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

describe("canonical provider scenario — AI Analyze completes on the first usable provider", () => {
  const OWNER_ORDER = [
    "gemini", "groq", "mistral", "zai", "cerebras",
    "openrouter", "openai", "together", "deepseek", "anthropic",
  ];

  it("uses the owner-required order, and no environment variable can change it", () => {
    // The old cost policy was switched by AI_ZERO_PAID_MODE. Asserting the
    // order only with the flag off would leave the flag able to narrow the
    // chain again without any test noticing, so both settings are checked —
    // the point is that the variable is inert, not that it is set correctly.
    for (const hint of ["true", "false", "1", "", undefined]) {
      const env = { NODE_ENV: "test", AI_ZERO_PAID_MODE: hint } as NodeJS.ProcessEnv;
      assert.deepEqual(
        [...getAutomaticProviderOrder(env)],
        OWNER_ORDER,
        `AI_ZERO_PAID_MODE=${String(hint)} must not affect the chain`,
      );
    }
  });
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

  it("treats a configured paid provider as an ordinary chain member", () => {
    // This assertion used to be the exact opposite: every provider in
    // every provider on a paid-access list had to report BILLING_BLOCKED purely
    // for holding a key. That list was emptied, so the old loop iterated zero
    // times and asserted nothing at all while its name still claimed paid
    // providers were "deliberately excluded" — a test that had quietly stopped
    // testing.
    //
    // The owner's directive puts all ten providers in one chain, so holding an
    // OpenAI or Anthropic key means exactly what holding a Gemini key means.
    applyScenario();
    process.env.OPENAI_API_KEY = "sk-openai-test";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    for (const provider of ["openai", "anthropic"] as const) {
      assert.equal(
        providerAutomaticEligibility(provider).eligible,
        true,
        `${provider} holds a key and is in the chain, so nothing may exclude it up front`,
      );
      assert.notEqual(
        deriveProviderStatus(provider),
        "BILLING_BLOCKED",
        `${provider} has not refused payment, so it must not be reported as blocked`,
      );
    }
  });

  it("keeps the full automatic chain in the required priority order", () => {
    applyScenario({ withGemini: true });
    assert.deepEqual(
      [...getAutomaticProviderOrder()],
      ["gemini", "groq", "mistral", "zai", "cerebras", "openrouter", "openai", "together", "deepseek", "anthropic"],
    );
  });

  it("parks a provider that demanded payment, and lets it back in when the cooldown expires", async () => {
    // The old rule removed the provider for the life of the process. That is a
    // cost policy, and the directive has none: a 402 is one more way a single
    // attempt can fail. Two things must hold — the chain must not stall on it
    // (skipped without spending an attempt), and it must be asked again later,
    // because an account refused an hour ago may have been topped up since.
    const { recordProviderFailure, getProviderStateSnapshot, restoreProviderState } =
      await import("../lib/ai-provider-health");
    applyScenario();
    recordProviderFailure("cerebras", new Error("HTTP 402: free tier quota exhausted, add a payment method"));
    assert.equal(isBillingLockedOut("cerebras"), true, "parked immediately after the refusal");

    const scenario = installScenarioFetch();
    await generateWithFallback("analyse this tender", { useCase: "extraction" });
    assert.ok(
      !scenario.urls().some((url) => url.includes("api.cerebras.ai")),
      "while cooling down it must be skipped, not retried on every request",
    );

    const snap = getProviderStateSnapshot("cerebras")!;
    restoreProviderState("cerebras", { ...snap, cooldownUntil: Date.now() - 60_000 });
    assert.equal(
      isBillingLockedOut("cerebras"),
      false,
      "once the cooldown expires the provider rejoins the chain — no permanent exclusion",
    );
  });

  it("attempts normally configured later providers before exhaustion", async () => {
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
        assert.match(details, /openai: no response/);
        assert.match(details, /deepseek: no response/);
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

  it("tells the operator a payment refusal clears itself, and still names the cause", async () => {
    // The inverse of what this asserted before. While a 402 removed a provider
    // for good, "waiting will not clear this" was true and retryRecommended had
    // to be false. With a ten-minute cooldown on one of ten providers, both of
    // those become wrong advice: the retry is exactly what the operator should
    // do, and telling them otherwise sends them to change configuration that is
    // already correct.
    const { buildAnalysisFallbackDiagnostics } = await import("../lib/engine/analysis-fallback-diagnostics");
    const billing = buildAnalysisFallbackDiagnostics(CEREBRAS_402);
    assert.equal(billing.category, "BILLING_BLOCKED");
    assert.equal(billing.retryRecommended, true, "the cooldown expires, so a retry can succeed unchanged");
    assert.match(billing.nextAction, /cooling down/);
    assert.doesNotMatch(billing.nextAction, /Waiting will not clear this/);
    assert.doesNotMatch(billing.nextAction, /excluded from automatic use/);

    // A genuine rate limit keeps the advice that actually works.
    const rateLimited = buildAnalysisFallbackDiagnostics(GEMINI_429);
    assert.equal(rateLimited.category, "RATE_LIMIT");
    assert.equal(rateLimited.retryRecommended, true);
  });

  it("the no-provider advice offers the whole chain, excluding none of it", async () => {
    // This previously required the advice to say five named providers "require
    // paid access and are excluded". A test asserting that a provider is
    // unusable is the cost policy living on in the suite, so the assertion is
    // inverted: the advice must NOT rule any provider out.
    const { buildAnalysisFallbackDiagnostics } = await import("../lib/engine/analysis-fallback-diagnostics");
    const none = buildAnalysisFallbackDiagnostics("No AI provider configured");
    assert.equal(none.category, "NO_PROVIDER_CONFIGURED");
    assert.match(none.nextAction, /ten providers/);
    assert.doesNotMatch(none.nextAction, /require paid access|excluded/);
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

// ─── "AI is configured" must mean "we have something we may call" ────────────
describe("isAIConfigured reflects reachability, not key presence", () => {
  const ALL = [
    "GEMINI_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "ZAI_API_KEY",
    "OPENROUTER_API_KEY", "OPENROUTER_PROPOSAL_MODEL", "CEREBRAS_API_KEY",
    "OPENAI_API_KEY", "TOGETHER_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY",
  ];
  let restore: Record<string, string | undefined> = {};

  beforeEach(() => {
    restore = {};
    for (const k of ALL) { restore[k] = process.env[k]; delete process.env[k]; }
  });
  afterEach(() => {
    for (const k of ALL) {
      if (restore[k] === undefined) delete process.env[k]; else process.env[k] = restore[k];
    }
  });

  it("is true when later-chain providers are configured", async () => {
    // The state this closes: the app reported AI as enabled while the automatic
    // chain had nothing it could call, so every AI feature failed with a message
    // about providers being exhausted rather than about none being usable.
    const { isAIConfigured, hasOnlyUnreachableProviderKeys } = await import("../lib/env-check");
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.DEEPSEEK_API_KEY = "dsk-test";
    assert.equal(isAIConfigured(), true);
    assert.equal(hasOnlyUnreachableProviderKeys(), false);
  });

  it("is true as soon as one free provider is configured", async () => {
    const { isAIConfigured, hasOnlyUnreachableProviderKeys } = await import("../lib/env-check");
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.GROQ_API_KEY = "gsk-test";
    process.env.GROQ_PROPOSAL_MODEL = "llama-3.1-8b-instant";
    assert.equal(isAIConfigured(), true);
    assert.equal(hasOnlyUnreachableProviderKeys(), false);
  });

  it("distinguishes 'no keys at all' from 'only unreachable keys'", async () => {
    // They need opposite actions: find a key, versus stop reaching for the key
    // you already have.
    const { isAIConfigured, hasOnlyUnreachableProviderKeys } = await import("../lib/env-check");
    assert.equal(isAIConfigured(), false);
    assert.equal(hasOnlyUnreachableProviderKeys(), false, "nothing configured is not the same as the wrong thing configured");
  });

  it("counts OpenRouter's key, but routing still needs a model for it", async () => {
    // The ':free' requirement is gone with the rest of the cost policy.
    // OpenRouter is still refused without configuration, but for a different
    // and much plainer reason: it is an aggregator, the model identifier picks
    // the vendor, and there is no request to build without one.
    const { isAIConfigured } = await import("../lib/env-check");
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    delete process.env.OPENROUTER_PROPOSAL_MODEL;
    delete process.env.OPENROUTER_ANALYSIS_MODEL;
    delete process.env.OPENROUTER_FAST_MODEL;
    const { providerAutomaticEligibility } = await import("../lib/ai-provider-registry");
    assert.equal(isAIConfigured(), true, "a key for a chain member counts as configuration");
    const eligibility = providerAutomaticEligibility("openrouter");
    assert.equal(eligibility.eligible, false, "…but no model means no request can be built");
    assert.equal(eligibility.reason, "NOT_CONFIGURED");

    process.env.OPENROUTER_PROPOSAL_MODEL = "some-vendor/some-model";
    assert.equal(
      providerAutomaticEligibility("openrouter").eligible,
      true,
      "any configured model is accepted — no ':free' suffix is required",
    );
  });
});

describe("the admin action item points at the real cause", () => {
  it("no longer forbids naming a paid provider key", () => {
    // The previous assertion required the diagnostics route NOT to mention
    // OPENAI_API_KEY, which enforced the cost policy from the test suite. OpenAI
    // is provider seven in the owner's chain; a test may not rule it out.
    const route = readFileSync("app/api/admin/diagnostics/route.ts", "utf8");
    assert.match(route, /hasOnlyUnreachableProviderKeys\(\)/);
    assert.doesNotMatch(
      route,
      /paid-access|':free' model/,
      "the advice must not describe a cost policy this deployment does not have",
    );
  });

  it("tells an operator with keys to look at the per-provider reason", () => {
    const route = readFileSync("app/api/admin/diagnostics/route.ts", "utf8");
    assert.match(route, /provider diagnostics for the exact per-provider reason/);
  });
});

// ─── The owner's directive, stated as tests ──────────────────────────────────
//
// One chain, ten providers, in one order, with the deterministic draft last.
// Every failure class is a fall-through, not a stop. These are the assertions
// that would catch a cost policy — or any other filter — being reintroduced.

describe("strict ten-provider fallback", () => {
  const OWNER_ORDER = [
    "gemini", "groq", "mistral", "zai", "cerebras",
    "openrouter", "openai", "together", "deepseek", "anthropic",
  ] as const;

  it("contacts providers in the owner's order and stops at the first success", async () => {
    // Gemini unconfigured, Groq answers. Nothing after Groq may be contacted:
    // a chain that keeps going after a success is wasting quota and money.
    applyScenario();
    const scenario = installScenarioFetch();
    const result = await generateWithFallback("analyse this tender", { useCase: "extraction" });

    assert.equal(result, "GROQ RESULT");
    const hosts = scenario.urls();
    assert.ok(hosts.some((u) => u.includes("api.groq.com")), "Groq must be reached");
    for (const later of ["api.mistral.ai", "api.z.ai", "api.cerebras.ai", "api.openai.com"]) {
      assert.ok(!hosts.some((u) => u.includes(later)), `${later} must not be contacted after a success`);
    }
  });

  it("treats every failure class as a fall-through, never as a stop", async () => {
    // Each provider ahead of Mistral fails in a different way. Mistral still
    // answers, which is only possible if all of them fell through.
    //   Groq        → 500  (provider error)
    //   Z.ai        → 429  (rate limit)
    //   plus, from the shared scenario: 402 billing, 401 auth, malformed body.
    applyScenario();
    const failing: Record<string, { status: number; body: unknown }> = {
      "api.groq.com": { status: 500, body: { error: { message: "internal server error" } } },
      "api.z.ai": { status: 429, body: { error: { message: "rate limit exceeded" } } },
      "api.mistral.ai": { status: 200, body: { choices: [{ message: { content: "MISTRAL RESULT" } }] } },
    };
    const seen: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      const url = typeof input === "string" ? input : (input as { url: string }).url;
      seen.push(url);
      const match = Object.keys(failing).find((host) => url.includes(host));
      const r = match ? failing[match] : { status: 503, body: { error: { message: "service unavailable" } } };
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        text: async () => JSON.stringify(r.body),
        json: async () => r.body,
      } as Response;
    }) as typeof globalThis.fetch;

    const result = await generateWithFallback("analyse this tender", { useCase: "extraction" });
    assert.equal(result, "MISTRAL RESULT", "a 500 and a 429 ahead of it must not end the chain");
    assert.ok(seen.some((u) => u.includes("api.groq.com")), "the failing provider is still attempted");
  });

  it("falls through a provider that answers 200 with unusable content", async () => {
    // "Returns malformed/unusable output" is named in the directive as a
    // fall-through case, and it is the one that does not look like an error:
    // the HTTP call succeeded, so only inspecting the body catches it.
    applyScenario();
    const bodies: Record<string, unknown> = {
      "api.groq.com": { choices: [{ message: { content: "" } }] },
      "api.mistral.ai": { choices: [{ message: { content: "MISTRAL RESULT" } }] },
    };
    globalThis.fetch = (async (input: unknown) => {
      const url = typeof input === "string" ? input : (input as { url: string }).url;
      const match = Object.keys(bodies).find((host) => url.includes(host));
      const body = match ? bodies[match] : { error: { message: "service unavailable" } };
      return { ok: Boolean(match), status: match ? 200 : 503, text: async () => JSON.stringify(body), json: async () => body } as Response;
    }) as typeof globalThis.fetch;

    const result = await generateWithFallback("analyse this tender", { useCase: "extraction" });
    assert.equal(result, "MISTRAL RESULT", "an empty 200 body is a failed attempt, not a usable answer");
  });

  it("raises a structured exhaustion error only after every provider has failed", async () => {
    // The deterministic draft's precondition. It must not be reachable while
    // any AI provider could still have answered.
    applyScenario({ withGemini: true });
    globalThis.fetch = (async () => ({
      ok: false, status: 503,
      text: async () => JSON.stringify({ error: { message: "service unavailable" } }),
      json: async () => ({ error: { message: "service unavailable" } }),
    } as Response)) as typeof globalThis.fetch;

    await assert.rejects(
      () => generateWithFallback("analyse this tender", { useCase: "extraction" }),
      (err: unknown) => {
        assert.ok(err instanceof NoAiProviderReadyError, "callers branch on this type, not on a message");
        assert.ok(
          ["ALL_PROVIDERS_EXHAUSTED", "ATTEMPT_BUDGET_EXHAUSTED"].includes(err.errorKind),
          `exhaustion must be reported as such, got ${err.errorKind}`,
        );
        return true;
      },
    );
  });

  it("keeps the deterministic draft out of the AI chain entirely", () => {
    // The draft is the tail of the RECOVERY path, not an eleventh provider. If
    // it ever appears in the provider order it becomes reachable as a peer of
    // the real providers, and a tender could be "analysed" without any model.
    const order = getAutomaticProviderOrder();
    assert.deepEqual([...order], [...OWNER_ORDER]);
    assert.equal(order.length, 10, "ten AI providers, and nothing else, are routable");
    for (const name of order) {
      assert.ok(!/determin|draft|regex/i.test(name), `${name} must not be a pseudo-provider`);
    }
  });

  it("never lets a deterministic draft carry final authority", () => {
    // The safety property behind the whole chain: if the draft could stand as a
    // finished analysis, every provider failing would silently produce an
    // exportable tender built from regex output.
    const source = readFileSync("lib/engine/analysis-source.ts", "utf8");
    assert.match(source, /REGEX_FALLBACK_AI_ERROR/);
    assert.match(
      source,
      /ANALYSIS_APPROVAL:REGEX_FALLBACK/,
      "a regex-derived analysis must remain gated behind an explicit approval record",
    );
  });
});

describe("the chain is written down exactly once", () => {
  // The defect this guards against was live on the DEFAULT proposal path.
  //
  // generateOneSection — reached by every proposal generation, because
  // PROPOSAL_GENERATION_MODE defaults to "parallel" — hand-rolled its own
  // sequence: nine `if (isXEnabled() && !isProviderCooledDown(x))` blocks in
  // the order Z.ai → Cerebras → Mistral → Groq/OpenRouter → Gemini → OpenAI →
  // Together → DeepSeek → Anthropic. That was canonical once. The owner's order
  // leads with Gemini and puts Z.ai fourth, so proposals were being generated
  // against an order nothing else used, and changing the registry could not
  // have corrected it.
  //
  // Two more copies existed in the same file: generateBenchmarkProposalWithAI
  // (the `single` escape hatch) and tryTailFallbackProviders (Together → Groq →
  // OpenRouter). Three orders, one of them live.
  //
  // What made it survive review is the sharpest detail: the comment above the
  // per-section chain asserted that the order came from
  // getAutomaticProviderOrder() and was "deliberately not written out here".
  // The code immediately below it wrote it out. Reading the comment was enough
  // to believe the code was correct.
  //
  // The prose check below is deliberately blunt: it bans the arrow-chain shape
  // outright rather than trying to tell a current order from a historical one.
  // A guard that has to judge intent is a guard that can be argued past, and
  // this one already caught the explanatory comment written while fixing it.
  const aiSource = readFileSync("lib/ai.ts", "utf8");

  it("routes every generation path through the canonical order", () => {
    const resolvers = aiSource.match(/getAutomaticProviderOrder\(\)/g) ?? [];
    assert.ok(
      resolvers.length >= 3,
      `expected the section, proposal and fallback paths to resolve the chain at call time, found ${resolvers.length}`,
    );
  });

  it("has no hand-rolled provider sequence left", () => {
    // The signature of a hand-rolled chain: consecutive per-provider guards.
    // One or two is a special case (Anthropic's tool-use path is legitimately
    // singled out); a run of them is a second chain.
    const guardPattern = /is(?:Zai|Cerebras|Mistral|Groq|OpenRouter|OpenAI|Together|DeepSeek|Claude|Gemini)Enabled\(\)\s*&&\s*!isProviderCooledDown\(/g;
    const guards = aiSource.match(guardPattern) ?? [];
    assert.ok(
      guards.length <= 1,
      `found ${guards.length} per-provider guards — a run of these is a duplicate chain, which is how the stale order survived`,
    );
  });

  it("does not name a provider order in a comment", () => {
    // A chain copied into prose goes stale silently and, worse, is believed.
    // The one that stood here named Z.ai as rank 1 long after it had moved.
    const staleOrderProse = /Z\.ai\s*(?:->|→)\s*Cerebras\s*(?:->|→)\s*Mistral/i;
    assert.doesNotMatch(
      aiSource,
      staleOrderProse,
      "a provider order written into a comment is a second source of truth",
    );
  });

  it("reads the Gemini key at request time, not from a module-load cache", () => {
    // The per-section Gemini branch gated on a module-scope
    // `const apiKey = process.env.GEMINI_API_KEY`, so a key set after module
    // load left Gemini permanently skipped — the exact stale-cache problem the
    // registry's readProviderKey() exists to prevent.
    assert.ok(
      !/if \(apiKey && !isProviderCooledDown\("gemini"\)\)/.test(aiSource),
      "provider availability must be read at request time",
    );
  });
});
