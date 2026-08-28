import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ANALYSIS_CHUNK_OVERLAP,
  analysisFitsOneConfiguredProvider,
  chunkTenderContent,
  generateWithFallback,
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
  it("keeps a representative 12,122-character tender in one request when the exact extraction model can accept it", () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_ANALYSIS_MODEL = "gemini-3.5-flash";
    const source = "consultancy supervision requirement. ".repeat(400).slice(0, 12_122).padEnd(12_122, "x");

    assert.equal(source.length, 12_122);
    assert.equal(analysisFitsOneConfiguredProvider(source), true);
    assert.deepEqual(chunkTenderContent(source), [source]);
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
