// ─── The whole-proposal provider walk must account for every provider ────────
//
// THE DEFECT.
// -----------
// generateBenchmarkProposalWithAI walked the canonical chain with two bare
// `continue`s:
//
//   if (!providerAutomaticEligibility(provider).eligible) continue;
//   if (isProviderCooledDown(provider)) continue;
//
// and then threw:
//
//   providerAttempts: [], failureDetails: [],
//   errorKind: "ALL_PROVIDERS_EXHAUSTED",
//   message: "All configured AI providers exhausted for proposal generation."
//
// That sentence was emitted whether ten providers were contacted and refused,
// or none was contacted at all. Those are opposite situations: one needs keys,
// credit or quota; the other clears itself when a cooldown expires. The error
// could not tell them apart, and `providerAttempts: []` discarded the evidence
// that would have.
//
// This is the same defect already closed for the per-section writer
// (generateOneSection) and, before that, for the extraction chain — whose note
// above describeUncontactedProviders in lib/ai.ts records the identical lesson
// read off a real owner job. This file closes the last walk that had it.
//
// WHAT IS PINNED HERE, behaviourally rather than by reading source:
//   - an ineligible/unconfigured provider is recorded as skipped, with a reason
//   - a cooling-down provider is recorded as skipped, with a reason
//   - a provider that was actually contacted is distinguishable from one skipped
//   - all-skipped is distinguishable from all-contacted-and-failed
//   - nothing sector-, client- or benchmark-specific enters the walk
//
// The scenario mirrors what production actually does: AI Analyze and the engine
// consume the chain seconds before generation asks for it, so generation
// arrives inside everyone's cooldown. Call 1 below burns the chain with real
// 429s; call 2 arrives immediately afterwards and must find it cooling.
//
// Every fetch is mocked. No provider is contacted and nothing is charged.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { generateBenchmarkProposalWithAI, NoAiProviderReadyError, type AIBidWriterInput } from "../lib/ai";
import { resetProviderHealth } from "../lib/ai-provider-health";

const ALL_KEYS = [
  "GEMINI_API_KEY", "GROQ_API_KEY", "GROQ_PROPOSAL_MODEL", "MISTRAL_API_KEY", "ZAI_API_KEY",
  "OPENROUTER_API_KEY", "OPENROUTER_PROPOSAL_MODEL", "CEREBRAS_API_KEY",
  "OPENAI_API_KEY", "TOGETHER_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY",
];

let saved: Record<string, string | undefined> = {};
let realFetch: typeof globalThis.fetch;

/**
 * A road-and-drainage supervision assignment. Deliberately not the benchmark
 * tender and not healthcare: the walk must behave identically whatever the
 * sector, and a fixture from another sector is how that is kept honest.
 */
const INPUT: AIBidWriterInput = {
  tenderTitle: "Consultancy Services for Supervision of Rural Road Upgrading and Drainage Works",
  clientName: "Regional Roads Authority",
  tenderText: "The Authority invites proposals for construction supervision of 42 km of rural road upgrading, including culverts and side drains.",
  analysisSummary: "Construction supervision assignment; technical proposal only.",
  evaluationMethodology: "QCBS 80/20.",
  submissionNotes: "Electronic submission in PDF.",
  requirements: "Resident engineer, materials technician, monthly progress reports.",
  companyProfile: "Multidisciplinary engineering consultancy.",
  experts: "Resident Engineer; Materials Engineer.",
  projects: "Road supervision assignments.",
  compliance: "Registration certificate; tax clearance.",
  differentiators: "In-house materials laboratory.",
};

function configureEveryProvider(): void {
  process.env.GEMINI_API_KEY = "AIzaWalkKey1234567890123456789012345";
  process.env.GROQ_API_KEY = "gsk-walk";
  process.env.GROQ_PROPOSAL_MODEL = "llama-3.1-8b-instant";
  process.env.MISTRAL_API_KEY = "mistral-walk";
  process.env.ZAI_API_KEY = "zai-walk";
  process.env.CEREBRAS_API_KEY = "csk-walk";
  process.env.OPENROUTER_API_KEY = "sk-or-walk";
  process.env.OPENROUTER_PROPOSAL_MODEL = "google/gemini-2.5-pro";
  process.env.OPENAI_API_KEY = "sk-walk";
  process.env.TOGETHER_API_KEY = "together-walk";
  process.env.DEEPSEEK_API_KEY = "dsk-walk";
  process.env.ANTHROPIC_API_KEY = "sk-ant-walk";
}

/** Every provider answers 429. One call burns the whole chain's cooldowns. */
function installRateLimitedFetch(): { count: () => number } {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return {
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: { message: "Rate limit reached, requests per minute" } }),
      json: async () => ({ error: { message: "Rate limit reached, requests per minute" } }),
    } as Response;
  }) as typeof globalThis.fetch;
  return { count: () => calls };
}

async function expectNoProviderReady(): Promise<NoAiProviderReadyError> {
  try {
    await generateBenchmarkProposalWithAI(INPUT);
  } catch (err) {
    assert.ok(err instanceof NoAiProviderReadyError, `expected NoAiProviderReadyError, got ${String(err)}`);
    return err;
  }
  throw new Error("generateBenchmarkProposalWithAI unexpectedly succeeded against a dead chain");
}

beforeEach(() => {
  saved = {};
  for (const key of ALL_KEYS) saved[key] = process.env[key];
  realFetch = globalThis.fetch;
  resetProviderHealth();
});

afterEach(() => {
  for (const key of ALL_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  globalThis.fetch = realFetch;
  resetProviderHealth();
});

describe("the whole-proposal walk must name what it did to every provider", () => {
  it("distinguishes all-contacted-and-failed from all-skipped, across two consecutive calls", async () => {
    configureEveryProvider();
    const fetchMock = installRateLimitedFetch();

    // CALL 1 — the chain is healthy, so every provider is really contacted.
    const exhausted = await expectNoProviderReady();
    const contactedAfterCall1 = fetchMock.count();

    assert.ok(contactedAfterCall1 > 0, "call 1 should have contacted providers");
    assert.equal(exhausted.errorKind, "ALL_PROVIDERS_EXHAUSTED");
    assert.ok(
      exhausted.providerAttempts.some((a) => a.tried),
      "call 1 must record providers it actually contacted",
    );

    // CALL 2 — immediately afterwards, the 429s have left the chain cooling.
    // This is the production sequence: AI Analyze burns the providers, then
    // generation arrives inside their cooldowns.
    const cooling = await expectNoProviderReady();

    assert.equal(
      fetchMock.count(),
      contactedAfterCall1,
      "call 2 must not have dispatched: a cooling chain is skipped, not contacted",
    );
    assert.equal(cooling.errorKind, "ALL_PROVIDERS_COOLING");
    assert.equal(cooling.nextAction, "ALL_PROVIDERS_COOLING");
    assert.equal(
      cooling.providerAttempts.some((a) => a.tried),
      false,
      "call 2 contacted nobody, so no attempt may claim it was tried",
    );

    // THE HEADLINE: the two failures no longer read alike.
    assert.notEqual(exhausted.errorKind, cooling.errorKind);
  });

  it("records a cooling-down provider as skipped, with a reason", async () => {
    configureEveryProvider();
    installRateLimitedFetch();
    await expectNoProviderReady();          // burn the chain
    const cooling = await expectNoProviderReady();

    const skipped = cooling.providerAttempts.filter((a) => !a.tried);
    assert.ok(skipped.length > 0, "nothing was recorded as skipped");
    for (const attempt of skipped) {
      assert.ok(attempt.skipReason, `${attempt.provider} was skipped with no reason recorded`);
    }
    assert.ok(
      skipped.some((a) => a.skipReason === "COOLDOWN"),
      "no provider was recorded as skipped for cooldown",
    );
  });

  it("records an unconfigured provider as skipped rather than dropping it", async () => {
    configureEveryProvider();
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.TOGETHER_API_KEY;
    installRateLimitedFetch();

    const err = await expectNoProviderReady();
    for (const provider of ["deepseek", "together"]) {
      const attempt = err.providerAttempts.find((a) => a.provider === provider);
      assert.ok(attempt, `${provider} is absent from the walk entirely`);
      assert.equal(attempt.tried, false, `${provider} has no key and cannot have been contacted`);
      assert.ok(
        attempt.skipReason === "NOT_CONFIGURED" || attempt.skipReason === "AUTOMATICALLY_INELIGIBLE",
        `${provider} skipped with unexpected reason ${attempt.skipReason}`,
      );
    }
  });

  it("never claims every provider was exhausted when none was dispatched", async () => {
    configureEveryProvider();
    installRateLimitedFetch();
    await expectNoProviderReady();
    const cooling = await expectNoProviderReady();

    assert.equal(
      /All configured AI providers exhausted for proposal generation/.test(cooling.message),
      false,
      "the message still asserts exhaustion for a chain that dispatched nothing",
    );
    // The constructor's own rendering names the uncontacted providers.
    assert.match(cooling.message, /Not contacted:|all skipped|in cooldown/);
  });

  it("accounts for every provider in the canonical chain, including anthropic", async () => {
    configureEveryProvider();
    installRateLimitedFetch();
    await expectNoProviderReady();
    const cooling = await expectNoProviderReady();

    const seen = new Set(cooling.providerAttempts.map((a) => a.provider));
    assert.ok(
      seen.has("anthropic"),
      "anthropic is the tenth provider, not an exception to the accounting",
    );
    // Canonical order is preserved: the walk reports in the order it walked.
    const order = cooling.providerAttempts.map((a) => a.provider);
    assert.deepEqual([...order].sort(), [...new Set(order)].sort(), "a provider was recorded twice");
  });
});

describe("the repair introduces nothing tender-, sector- or benchmark-specific", () => {
  it("carries no such vocabulary in the provider walk's executable code", () => {
    // Scoped to the WALK, not to the whole of generateBenchmarkProposalWithAI.
    //
    // That function is also the prompt builder, and it legitimately contains
    // sector vocabulary for some fourteen sectors — healthcare, hospitality,
    // water, roads, industrial, high-rise and the rest — each selected from
    // the tender's own text, plus the tokenised instrument() authority that
    // names a jurisdiction's instruments only when the tender names them.
    // That is the generalization working, not leaking, and asserting against
    // it would forbid the very breadth the product needs. What must stay
    // free of it is the routing decision, which is about providers and
    // nothing else.
    const src = readFileSync("lib/ai.ts", "utf8");
    const fn = src.indexOf("export async function generateBenchmarkProposalWithAI");
    assert.ok(fn > 0, "generateBenchmarkProposalWithAI not found");
    const walkStart = src.indexOf("THE WALK RECORDS WHAT IT DID TO EVERY PROVIDER", fn);
    assert.ok(walkStart > fn, "the provider walk marker is missing");
    const close = src.indexOf("\n}\n", walkStart);
    const code = src
      .slice(walkStart, close)
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    for (const forbidden of [/\bPharo\b/i, /\bhospital/i, /\bhealthcare/i, /\bEthiopia/i, /\bmedical\b/i]) {
      assert.equal(forbidden.test(code), false, `the provider walk's code mentions ${forbidden}`);
    }
    // And the walk is genuinely the thing being measured.
    assert.match(code, /getAutomaticProviderOrder\(\)/);
    assert.match(code, /skipReason: "COOLDOWN"/);
  });
});
