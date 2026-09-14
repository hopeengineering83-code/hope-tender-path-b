import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ANALYSIS_CHUNK_OVERLAP,
  analysisChunkPreflight,
  chunkTenderContent,
  generateWithFallback,
  planAnalysisChunks,
} from "../lib/ai";
import { resetProviderHealth } from "../lib/ai-provider-health";
import { providerEnv, isolateProviderEnv } from "./helpers/provider-env";

// Every provider-scoped variable is cleared, not a hand-written list of nine.
// The list previously named only the Gemini/Groq/Mistral keys, so a leftover
// CEREBRAS_API_KEY or CEREBRAS_BASE_URL on the machine running the suite
// changed which providers these cases saw as configured.
let restoreProviderEnv: (() => void) | null = null;
let realFetch: typeof fetch;

beforeEach(() => {
  restoreProviderEnv = isolateProviderEnv();
  realFetch = globalThis.fetch;
  resetProviderHealth();
});

afterEach(() => {
  restoreProviderEnv?.();
  restoreProviderEnv = null;
  globalThis.fetch = realFetch;
  resetProviderHealth();
});

describe("adaptive AI Analyze request shape", () => {
  it("CASE A: the owner's retained 12,122-character source cannot be served by a tight-throughput free tier at ANY chunk size", () => {
    const env = providerEnv({
      GEMINI_API_KEY: "test-key",
      GEMINI_ANALYSIS_MODEL: "gemini-3.5-flash",
      GROQ_API_KEY: "test-key",
      GROQ_PROPOSAL_MODEL: "openai/gpt-oss-120b",
      GROQ_ANALYSIS_MODEL: "openai/gpt-oss-120b",
      MISTRAL_API_KEY: "test-key",
      MISTRAL_ANALYSIS_MODEL: "mistral-small-latest",
    });
    const source = "consultancy supervision requirement. ".repeat(400).slice(0, 12_122).padEnd(12_122, "x");
    const plan = planAnalysisChunks(source, env);
    assert.equal(source.length, 12_122);

    // WHAT THIS CASE ASSERTED BEFORE, AND WHY BOTH VERSIONS WERE WRONG.
    // -----------------------------------------------------------------
    // v1 asserted SINGLE_REQUEST with groq eligible for the whole source.
    // That was measured against the raw prompt, without the trust-boundary
    // fence, and the real fenced request was 7,242 tokens against a 7,088
    // budget. Groq was skipped before contact.
    //
    // v2 asserted the split "restores" groq. The owner's durable AiJob
    // 4a678bf3 then ran it and recorded, on chunk 1:
    //
    //   groq: Groq openai/gpt-oss-120b hit the output token budget before
    //         producing any content (max_tokens=1335) — raise the budget
    //
    // and on chunk 2:
    //
    //   groq: Rate limit ... Limit 8000, Used 5777
    //
    // The free tier spends ONE 8,000-token-per-minute budget on input AND
    // output. Splitting cannot rescue that here, and makes it worse: every
    // chunk repeats the ~4,200-token prompt template inside the same minute,
    // so more chunks means more total tokens, not fewer. There is no chunk
    // size at which this source fits. The honest plan is therefore to leave
    // groq out and route to a provider that can answer.
    assert.equal(plan.configuredProviders.includes("groq"), true, "groq is configured; this is about capacity, not configuration");
    assert.equal(plan.fullRequestEligibleProviders.includes("groq"), false);
    assert.equal(plan.chunkEligibleProviders.includes("groq"), false, "splitting must not pretend to restore a provider the tier cannot serve");

    // The chain still has providers that CAN answer, so the source is not
    // split for the sake of a provider that will refuse every piece of it.
    assert.deepEqual(plan.chunkEligibleProviders, ["gemini", "mistral"]);
    assert.equal(plan.reason, "SINGLE_REQUEST");
    assert.deepEqual(plan.chunks, [source]);
  });

  it("CASE B: a source IS split when splitting genuinely restores an early provider", () => {
    // The rule is not "never split for an early provider" — it is "only split
    // when the split actually produces chunks that provider can answer".
    // Gemini and Mistral carry large contexts and no free-tier throughput cap,
    // so a source above the single-request ceiling is split for coverage, and
    // every chunk must be answerable by the providers the plan names.
    const env = providerEnv({
      GEMINI_API_KEY: "test-key",
      GEMINI_ANALYSIS_MODEL: "gemini-3.5-flash",
      MISTRAL_API_KEY: "test-key",
      MISTRAL_ANALYSIS_MODEL: "mistral-small-latest",
    });
    const source = "source-grounded requirement and evidence. ".repeat(2_000).slice(0, 60_000);
    const plan = planAnalysisChunks(source, env);

    assert.equal(plan.reason, "LARGE_SOURCE");
    assert.ok(plan.chunks.length > 1);
    assert.ok(plan.chunks.every((chunk) => chunk.length <= 8_000));
    // Every chunk the plan produces must be answerable, output budget included.
    for (const provider of plan.chunkEligibleProviders) {
      plan.chunks.forEach((chunk, index) => {
        const pf = analysisChunkPreflight(provider, chunk, index, plan.chunks.length, env);
        assert.ok(pf.eligible, `${provider} cannot answer chunk ${index}: ${pf.reason}`);
        assert.ok(pf.maxOutputTokens >= 2_048, `${provider} chunk ${index} output budget ${pf.maxOutputTokens} cannot carry a structured extraction`);
      });
    }
  });

  it("CASE C/D: large sources are lossless and retain final-chunk mandatory requirements", () => {
    const env = providerEnv({
      GEMINI_API_KEY: "test-key",
      GEMINI_ANALYSIS_MODEL: "gemini-3.5-flash",
    });
    const source = `${"large source section. ".repeat(4_000)}[PAGE:FINAL] MANDATORY unusual signed schedule`;
    const plan = planAnalysisChunks(source, env);
    const reconstructed = plan.chunks.reduce(
      (all, chunk, index) => all + (index === 0 ? chunk : chunk.slice(ANALYSIS_CHUNK_OVERLAP)),
      "",
    );
    assert.equal(plan.reason, "LARGE_SOURCE");
    assert.equal(reconstructed, source);
    assert.match(plan.chunks.at(-1) ?? "", /MANDATORY unusual signed schedule/);
  });

  it("CASE E: canonical order is never reordered by capacity — a provider is dropped for capacity, not demoted", () => {
    const env = providerEnv({
      GROQ_API_KEY: "test-key",
      GROQ_PROPOSAL_MODEL: "openai/gpt-oss-120b",
      GROQ_ANALYSIS_MODEL: "openai/gpt-oss-120b",
      OPENAI_API_KEY: "test-key",
      OPENAI_ANALYSIS_MODEL: "gpt-4.1",
    });
    const plan = planAnalysisChunks("x".repeat(20_000), env);

    // Configuration order is canonical and capacity never touches it: groq is
    // canonical rank 2 and openai rank 7, whatever either can currently carry.
    assert.deepEqual(plan.configuredProviders, ["groq", "openai"]);
    assert.ok(
      plan.configuredProviders.indexOf("groq") < plan.configuredProviders.indexOf("openai"),
      "canonical order must not be rewritten by capacity",
    );

    // Eligibility is a separate question from order. This source is far past
    // what an 8,000-token-per-minute tier can answer at any chunk size, so
    // groq is absent from the eligible sets — dropped on measured capacity,
    // while openai, which can carry it, remains.
    assert.equal(plan.chunkEligibleProviders.includes("groq"), false);
    assert.equal(plan.chunkEligibleProviders.includes("openai"), true);
  });

  it("chunks oversized sources without dropping the final page or overlap boundaries", () => {
    process.env.GROQ_API_KEY = "test-key";
    process.env.GROQ_ANALYSIS_MODEL = "openai/gpt-oss-120b";
    const source = `${"EOI consultancy scope and qualifications. ".repeat(2_000)}[PAGE:FINAL] MANDATORY signed declaration and portal submission instruction.`;
    const chunks = chunkTenderContent(source);

    assert.ok(chunks.length > 1);
    const reconstructed = chunks.reduce(
      (all, chunk, index) => all + (index === 0 ? chunk : chunk.slice(ANALYSIS_CHUNK_OVERLAP)),
      "",
    );
    assert.equal(reconstructed, source);
    assert.match(chunks.at(-1) ?? "", /MANDATORY signed declaration/);
    assert.match(chunks.at(-1) ?? "", /portal submission instruction/);
  });

  it("pins same-job chunk execution to one worker instead of three sibling provider chains", () => {
    const source = readFileSync("lib/ai.ts", "utf8");
    assert.match(source, /const CONCURRENCY_LIMIT = 1;/);
    assert.doesNotMatch(source, /concurrent analysis calls \(limit=3\)/);
  });

});

describe("structured response fall-through", () => {
  it("skips a provider whose same-job TPM window is already reserved without consuming a network attempt", async () => {
    process.env.GROQ_API_KEY = "groq-test";
    process.env.GROQ_PROPOSAL_MODEL = "openai/gpt-oss-120b";
    process.env.GROQ_ANALYSIS_MODEL = "openai/gpt-oss-120b";
    process.env.MISTRAL_API_KEY = "mistral-test";
    process.env.MISTRAL_ANALYSIS_MODEL = "mistral-small-latest";
    const hosts: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      hosts.push(new URL(url).host);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: '{"summary":"paced success","requirements":[]}' } }] }),
        json: async () => ({ choices: [{ message: { content: '{"summary":"paced success","requirements":[]}' } }] }),
      } as Response;
    }) as typeof fetch;

    const result = await generateWithFallback("extract", {
      useCase: "extraction",
      validateResponse: (text) => text.includes("paced success"),
      providerSkipReasons: { groq: "same-job TPM window is reserved" },
    });

    assert.match(result, /paced success/);
    assert.deepEqual(hosts, ["api.mistral.ai"]);
  });

  it("rejects empty/malformed Groq output and continues to Mistral without replaying the whole chain", async () => {
    process.env.GROQ_API_KEY = "groq-test";
    process.env.GROQ_MODEL = "openai/gpt-oss-120b";
    process.env.GROQ_PROPOSAL_MODEL = "openai/gpt-oss-120b";
    process.env.GROQ_FAST_MODEL = "openai/gpt-oss-120b";
    process.env.GROQ_ANALYSIS_MODEL = "openai/gpt-oss-120b";
    process.env.MISTRAL_API_KEY = "mistral-test";
    process.env.MISTRAL_ANALYSIS_MODEL = "mistral-small-latest";
    const hosts: string[] = [];
    const models: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      hosts.push(new URL(url).host);
      const rawBody = input instanceof Request ? await input.clone().text() : String(init?.body ?? "{}");
      const body = JSON.parse(rawBody || "{}") as { model?: string };
      if (body.model) models.push(body.model);
      const content = url.includes("groq") ? "{}" : '{"summary":"usable extraction","requirements":[]}';
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
        json: async () => ({ choices: [{ message: { content } }] }),
      } as Response;
    }) as typeof fetch;

    const result = await generateWithFallback("extract", {
      useCase: "extraction",
      validateResponse: (text) => text.includes("usable extraction"),
    });

    assert.match(result, /usable extraction/);
    assert.deepEqual(hosts, ["api.groq.com", "api.mistral.ai"]);
    assert.deepEqual(models, ["openai/gpt-oss-120b", "mistral-small-latest"]);
  });
});
