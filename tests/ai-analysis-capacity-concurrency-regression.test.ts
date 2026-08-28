import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ANALYSIS_CHUNK_OVERLAP,
  analysisFitsOneConfiguredProvider,
  chunkTenderContent,
  generateWithFallback,
  planAnalysisChunks,
} from "../lib/ai";
import { resetProviderHealth } from "../lib/ai-provider-health";

const ENV_KEYS = [
  "GEMINI_API_KEY", "GEMINI_ANALYSIS_MODEL", "GROQ_API_KEY", "GROQ_MODEL", "GROQ_PROPOSAL_MODEL", "GROQ_ANALYSIS_MODEL", "GROQ_FAST_MODEL",
  "MISTRAL_API_KEY", "MISTRAL_ANALYSIS_MODEL",
] as const;
let saved: Record<string, string | undefined> = {};
let realFetch: typeof fetch;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  realFetch = globalThis.fetch;
  resetProviderHealth();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  globalThis.fetch = realFetch;
  resetProviderHealth();
});

describe("adaptive AI Analyze request shape", () => {
  it("CASE A: keeps one request when all configured early extraction models can accept it", () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_ANALYSIS_MODEL = "gemini-3.5-flash";
    const source = "consultancy supervision requirement. ".repeat(400).slice(0, 12_122).padEnd(12_122, "x");

    assert.equal(source.length, 12_122);
    assert.equal(analysisFitsOneConfiguredProvider(source), true);
    assert.deepEqual(chunkTenderContent(source), [source]);
  });

  it("CASE B: restores Groq through sequential chunks when a monolith exceeds its exact TPM profile", () => {
    const env = {
      ...process.env,
      GEMINI_API_KEY: "test-key",
      GEMINI_ANALYSIS_MODEL: "gemini-3.5-flash",
      GROQ_API_KEY: "test-key",
      GROQ_PROPOSAL_MODEL: "openai/gpt-oss-120b",
      GROQ_ANALYSIS_MODEL: "openai/gpt-oss-120b",
      MISTRAL_API_KEY: "test-key",
      MISTRAL_ANALYSIS_MODEL: "mistral-small-latest",
    };
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
    const env = {
      ...process.env,
      GEMINI_API_KEY: "test-key",
      GEMINI_ANALYSIS_MODEL: "gemini-3.5-flash",
    };
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
    const env = {
      ...process.env,
      GROQ_API_KEY: "test-key",
      GROQ_PROPOSAL_MODEL: "openai/gpt-oss-120b",
      GROQ_ANALYSIS_MODEL: "openai/gpt-oss-120b",
      OPENAI_API_KEY: "test-key",
      OPENAI_ANALYSIS_MODEL: "gpt-4.1",
    };
    const plan = planAnalysisChunks("x".repeat(20_000), env);
    assert.deepEqual(plan.configuredProviders.slice(0, 2), ["groq", "openai"]);
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
