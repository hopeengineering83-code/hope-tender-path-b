import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { preflightProvider } from "../lib/ai-preflight";
import { classifyProviderError } from "../lib/ai-provider-classification";
import {
  getProviderHealth,
  isProviderCooledDown,
  recordProviderFailure,
  resetProviderHealth,
} from "../lib/ai-provider-health";
import {
  ANALYSIS_CHUNK_OVERLAP,
  ANALYSIS_CHUNK_SIZE,
  chunkTenderContent,
  wasContentTruncatedByChunkCap,
} from "../lib/ai";

describe("provider request budgeting regressions", () => {
  it("does not let a stale attempt override of 3 truncate the ten-provider chain", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "-e", "process.stdout.write(String(require('./lib/ai.ts').MAX_PROVIDER_ATTEMPTS_PER_REQUEST));"],
      {
        cwd: process.cwd(),
        env: { ...process.env, AI_MAX_PROVIDER_ATTEMPTS: "3" },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "10");
  });

  it("budgets Groq input, output, and safety margin under the model TPM ceiling", () => {
    const env = {
      ...process.env,
      GROQ_API_KEY: "test",
      GROQ_ANALYSIS_MODEL: "openai/gpt-oss-120b",
    };
    const result = preflightProvider("groq", "x".repeat(8_000), {
      systemPrompt: "s".repeat(2_000),
      useCase: "extraction",
      env,
    });
    assert.equal(result.eligible, true);
    assert.ok(result.maxOutputTokens >= 512);
    assert.ok(result.estimatedTokens + result.maxOutputTokens + 400 <= 8_000);
  });

  it("rejects a known-over-limit model before transmission", () => {
    const result = preflightProvider("openrouter", "x".repeat(30_000), {
      systemPrompt: "s".repeat(2_000),
      useCase: "extraction",
      modelOverride: "operator/unknown-small-model",
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "CONTEXT_OVERFLOW");
    assert.equal(result.maxOutputTokens, 0);
  });

  it("classifies HTTP 413 as request shape and never cools provider health", () => {
    resetProviderHealth();
    assert.equal(classifyProviderError({ status: 413, message: "request too large" }), "REQUEST_TOO_LARGE");
    recordProviderFailure("groq", { status: 413, message: "context length exceeded" });
    assert.equal(getProviderHealth("groq").lastFailureCategory, "REQUEST_TOO_LARGE");
    assert.equal(isProviderCooledDown("groq"), false);
    resetProviderHealth();
  });
});

describe("analysis source-fidelity chunking", () => {
  it("covers short, medium, long, multi-page, and cross-sector final-page obligations", () => {
    const cases = [
      "Short building tender: submit a technical proposal.",
      "Road/highway scope. ".repeat(350),
      "Water and hydraulic scope. ".repeat(2_000),
      Array.from({ length: 25 }, (_, page) => `[PAGE:${page + 1}] geotechnical source text ${"x".repeat(700)}`).join("\n"),
      `${"Construction supervision EOI. ".repeat(1_500)}[PAGE:FINAL] MANDATORY: submit the signed declaration. SUBMISSION: upload the PDF before 17:00.`,
    ];

    for (const source of cases) {
      const chunks = chunkTenderContent(source);
      assert.equal(wasContentTruncatedByChunkCap(source, chunks), false);
      const reconstructed = chunks.reduce(
        (text, chunk, index) => text + (index === 0 ? chunk : chunk.slice(ANALYSIS_CHUNK_OVERLAP)),
        "",
      );
      assert.equal(reconstructed, source, `all source characters must survive (${source.length})`);
      assert.ok(chunks.every((chunk) => chunk.length <= ANALYSIS_CHUNK_SIZE));
      if (source.includes("[PAGE:FINAL]")) {
        assert.ok(chunks.some((chunk) => chunk.includes("MANDATORY: submit the signed declaration")));
        assert.ok(chunks.some((chunk) => chunk.includes("SUBMISSION: upload the PDF before 17:00")));
      }
    }
  });
});
