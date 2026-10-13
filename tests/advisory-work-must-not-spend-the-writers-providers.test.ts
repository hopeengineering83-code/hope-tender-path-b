// ─── Optional work must not consume the chain the writer needs ───────────────
//
// THE DEFECT, measured on run 35610060081 (Vercel runtime logs):
//
//   14:09:05  ENGINE_RUN  [ai-multi-perspective-matcher] EXPERT batch failed:
//                         "Contacted 10 of 10 configured provider(s)"
//                         groq: TPM Limit 8000, Used 4929 -> 429 -> cooldown
//   14:09:47  PROPOSAL_GENERATION starts
//   14:09:58  [ai] section "cover-and-summary" dispatched no provider —
//                  every eligible provider was cooling down
//
// The multi-perspective matcher is OPTIONAL. The engine discards its answer
// and logs "optional AI reranking failed or was skipped; authoritative
// deterministic selection remains valid". So work whose result was thrown away
// contacted all ten providers, tipped groq past its tokens-per-minute limit,
// and left the MANDATORY section writer with nothing 48 seconds later.
//
// runAsAdvisory's own note already forbids this — advisory work "must not
// outbid mandatory work for a scarce shared budget" — but it narrowed only the
// RETRY budget, not the provider FAN-OUT, so advisory work still walked the
// whole chain.
//
// THE RULE PINNED HERE: advisory work gets one provider; mandatory work keeps
// the chain. Nothing about canonical order, cooldown semantics or health truth
// changes — advisory still records what it observed about the provider it did
// contact.
//
// Every fetch is mocked. No provider is contacted and nothing is charged.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  generateWithFallback,
  runAsAdvisory,
  isAdvisoryContext,
  ADVISORY_MAX_PROVIDER_ATTEMPTS,
  MAX_PROVIDER_ATTEMPTS_PER_REQUEST,
} from "../lib/ai";
import { resetProviderHealth } from "../lib/ai-provider-health";

const ALL_KEYS = [
  "GEMINI_API_KEY", "GROQ_API_KEY", "GROQ_PROPOSAL_MODEL", "MISTRAL_API_KEY", "ZAI_API_KEY",
  "OPENROUTER_API_KEY", "OPENROUTER_PROPOSAL_MODEL", "CEREBRAS_API_KEY",
  "OPENAI_API_KEY", "TOGETHER_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY",
];

let saved: Record<string, string | undefined> = {};
let realFetch: typeof globalThis.fetch;

function configureEveryProvider(): void {
  process.env.GEMINI_API_KEY = "AIzaAdvisoryKey123456789012345678901";
  process.env.GROQ_API_KEY = "gsk-advisory";
  process.env.GROQ_PROPOSAL_MODEL = "llama-3.1-8b-instant";
  process.env.MISTRAL_API_KEY = "mistral-advisory";
  process.env.ZAI_API_KEY = "zai-advisory";
  process.env.CEREBRAS_API_KEY = "csk-advisory";
  process.env.OPENROUTER_API_KEY = "sk-or-advisory";
  process.env.OPENROUTER_PROPOSAL_MODEL = "google/gemini-2.5-pro";
  process.env.OPENAI_API_KEY = "sk-advisory";
  process.env.TOGETHER_API_KEY = "together-advisory";
  process.env.DEEPSEEK_API_KEY = "dsk-advisory";
  process.env.ANTHROPIC_API_KEY = "sk-ant-advisory";
}

/** Every provider refuses, so the chain walks as far as its budget allows. */
function installRefusingFetch(): { hosts: () => string[] } {
  const hosts: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as { url: string }).url;
    try { hosts.push(new URL(url).hostname); } catch { hosts.push(String(url)); }
    return {
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: { message: "Rate limit reached, tokens per minute" } }),
      json: async () => ({ error: { message: "Rate limit reached, tokens per minute" } }),
    } as Response;
  }) as typeof globalThis.fetch;
  return { hosts: () => hosts };
}

async function swallow(fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); } catch { /* every provider refuses; the error is the point */ }
}

beforeEach(() => {
  saved = {};
  for (const key of ALL_KEYS) saved[key] = process.env[key];
  realFetch = globalThis.fetch;
  resetProviderHealth();
  configureEveryProvider();
});

afterEach(() => {
  for (const key of ALL_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  globalThis.fetch = realFetch;
  resetProviderHealth();
});

describe("advisory work must not spend the writer's providers", () => {
  it("contacts far fewer providers than mandatory work does", async () => {
    const advisory = installRefusingFetch();
    await swallow(() => runAsAdvisory(() => generateWithFallback("advisory prompt", { useCase: "default" })));
    const advisoryHosts = new Set(advisory.hosts());

    resetProviderHealth();

    const mandatory = installRefusingFetch();
    await swallow(() => generateWithFallback("mandatory prompt", { useCase: "default" }));
    const mandatoryHosts = new Set(mandatory.hosts());

    assert.ok(
      advisoryHosts.size < mandatoryHosts.size,
      `advisory contacted ${advisoryHosts.size} provider host(s), mandatory ${mandatoryHosts.size} — advisory is still walking the chain`,
    );
    assert.ok(
      mandatoryHosts.size > 1,
      "the mandatory chain must still fan out across providers",
    );
  });

  it("leaves providers it never contacted untouched for the writer", async () => {
    const advisory = installRefusingFetch();
    await swallow(() => runAsAdvisory(() => generateWithFallback("advisory prompt", { useCase: "default" })));

    // The whole point: after optional work, the rest of the chain is still
    // there. In the measured failure, advisory had burned all ten.
    const contacted = new Set(advisory.hosts());
    assert.ok(
      contacted.size <= ADVISORY_MAX_PROVIDER_ATTEMPTS,
      `advisory contacted ${contacted.size} provider host(s), budget is ${ADVISORY_MAX_PROVIDER_ATTEMPTS}`,
    );
  });

  it("keeps the mandatory budget unchanged", () => {
    // Advisory is narrowed; mandatory work must not be.
    assert.ok(ADVISORY_MAX_PROVIDER_ATTEMPTS >= 1, "advisory must get a genuine chance");
    assert.ok(
      ADVISORY_MAX_PROVIDER_ATTEMPTS < MAX_PROVIDER_ATTEMPTS_PER_REQUEST,
      "advisory must not have the mandatory fan-out",
    );
    assert.equal(MAX_PROVIDER_ATTEMPTS_PER_REQUEST, 10, "the mandatory chain must still reach all ten");
  });

  it("scopes the narrowing to advisory context only", async () => {
    assert.equal(isAdvisoryContext(), false, "plain context must not be advisory");
    let insideAdvisory: boolean | null = null;
    await runAsAdvisory(async () => { insideAdvisory = isAdvisoryContext(); return null; });
    assert.equal(insideAdvisory, true, "runAsAdvisory must mark its async context");
    assert.equal(isAdvisoryContext(), false, "advisory context must not leak past the call");
  });
});
