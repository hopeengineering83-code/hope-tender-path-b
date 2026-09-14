import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ANALYSIS_CHUNK_OVERLAP,
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
  it("CASE A: the owner's retained 12,122-character source keeps Groq — by splitting, not by pretending it fits", () => {
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

    // WHAT THIS CASE USED TO ASSERT, AND WHY IT WAS WRONG.
    // --------------------------------------------------
    // It asserted `reason === "SINGLE_REQUEST"` and that gemini, groq and
    // mistral were all eligible for the whole 12,122 characters in one call.
    // That was measured against the RAW analysis prompt. The request actually
    // sent is that prompt wrapped by protectPrompt — a trust-boundary header,
    // two fence markers and a footer — which costs a further ~198 input tokens.
    //
    // Against the real, fenced request this source is 7,242 estimated input
    // tokens for openai/gpt-oss-120b, whose free-tier budget after the minimum
    // output reservation and margin is 7,088. Groq never accepted it. The
    // owner's durable AiJob recorded exactly that number:
    //
    //   groq: Prompt exceeds the configured provider throughput budget
    //         (7242 input tokens).
    //
    // with Groq absent from the job's `tried:` list. So this case had frozen
    // the defect as the expectation: the requirement was always "keep Groq in
    // the chain for this source", and a monolith Groq refuses does the exact
    // opposite. Splitting is what keeps Groq.
    assert.equal(plan.reason, "EARLY_CHAIN_DIVERSITY");
    assert.deepEqual(plan.configuredProviders.slice(0, 3), ["gemini", "groq", "mistral"]);
    assert.equal(plan.fullRequestEligibleProviders.includes("groq"), false);

    // The owner requirement, actually satisfied: Groq — canonical rank #2 —
    // can receive every chunk of this source.
    assert.equal(plan.chunkEligibleProviders.includes("groq"), true);
    assert.ok(plan.chunks.length > 1);

    // Splitting must not lose a character of the source.
    const reconstructed = plan.chunks.reduce(
      (all, chunk, index) => all + (index === 0 ? chunk : chunk.slice(ANALYSIS_CHUNK_OVERLAP)),
      "",
    );
    assert.equal(reconstructed, source);
  });

  it("CASE B: restores Groq through sequential chunks when a monolith exceeds its exact TPM profile", () => {
    const env = providerEnv({
      GEMINI_API_KEY: "test-key",
      GEMINI_ANALYSIS_MODEL: "gemini-3.5-flash",
      GROQ_API_KEY: "test-key",
      GROQ_PROPOSAL_MODEL: "openai/gpt-oss-120b",
      GROQ_ANALYSIS_MODEL: "openai/gpt-oss-120b",
      MISTRAL_API_KEY: "test-key",
      MISTRAL_ANALYSIS_MODEL: "mistral-small-latest",
    });
    // Represents the retained source plus canonical company/evidence context.
    // The former ANY-provider policy kept this monolithic because Gemini and
    // Mistral fit, even though it removed canonical rank #2 from the chain.
    const source = "source-grounded requirement and evidence. ".repeat(500).slice(0, 20_000);
    const plan = planAnalysisChunks(source, env);

    assert.equal(plan.reason, "EARLY_CHAIN_DIVERSITY");
    assert.equal(plan.fullRequestEligibleProviders.includes("groq"), false);
    assert.equal(plan.chunkEligibleProviders.includes("groq"), true);
    assert.ok(plan.chunks.length > 1);
    assert.ok(plan.chunks.every((chunk) => chunk.length <= 8_000));
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

  it("CASE E: a later huge-context provider cannot force a monolith that excludes configured Groq", () => {
    const env = providerEnv({
      GROQ_API_KEY: "test-key",
      GROQ_PROPOSAL_MODEL: "openai/gpt-oss-120b",
      GROQ_ANALYSIS_MODEL: "openai/gpt-oss-120b",
      OPENAI_API_KEY: "test-key",
      OPENAI_ANALYSIS_MODEL: "gpt-4.1",
    });
    const plan = planAnalysisChunks("x".repeat(20_000), env);
    // Exactly two providers are configured, so the whole list is assertable.
    // The relative claim is stated too, because that is what this case is
    // about: groq is canonical rank 2 and openai rank 7, and no later
    // huge-context provider may reorder them. Written as an absolute prefix
    // alone, this assertion used to fail whenever the machine running the
    // suite had a third provider configured — which put that provider at its
    // own correct canonical position, not at a wrong one.
    assert.deepEqual(plan.configuredProviders, ["groq", "openai"]);
    assert.ok(
      plan.configuredProviders.indexOf("groq") < plan.configuredProviders.indexOf("openai"),
      "groq precedes openai in the canonical order regardless of what else is configured",
    );
    assert.equal(plan.fullRequestEligibleProviders.includes("groq"), false);
    assert.equal(plan.chunkEligibleProviders.includes("groq"), true);
    assert.equal(plan.reason, "EARLY_CHAIN_DIVERSITY");
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
