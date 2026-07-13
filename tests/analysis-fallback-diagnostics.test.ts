import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildAnalysisFallbackDiagnostics, formatFallbackDiagnosticsLine } from "../lib/engine/analysis-fallback-diagnostics";

describe("analysis fallback diagnostics", () => {
  it("classifies timeout errors", () => {
    const result = buildAnalysisFallbackDiagnostics("AI analysis timed out after 50 seconds");
    assert.equal(result.category, "TIMEOUT");
    assert.equal(result.retryRecommended, true);
  });

  it("classifies rate limits", () => {
    const result = buildAnalysisFallbackDiagnostics("429 rate limit tokens per minute exceeded");
    assert.equal(result.category, "RATE_LIMIT");
    assert.equal(result.retryRecommended, true);
  });

  it("classifies auth/access failures", () => {
    const result = buildAnalysisFallbackDiagnostics("403 invalid API key unauthorized");
    assert.equal(result.category, "AUTH_OR_ACCESS");
    assert.equal(result.retryRecommended, false);
  });

  it("classifies malformed JSON", () => {
    const result = buildAnalysisFallbackDiagnostics("AI returned malformed JSON for tender analysis");
    assert.equal(result.category, "MALFORMED_AI_JSON");
  });

  it("redacts API key-like secrets", () => {
    const result = buildAnalysisFallbackDiagnostics("bad key sk-thisShouldNeverAppear123456789");
    assert.equal(result.message.includes("thisShouldNeverAppear"), false);
    assert.equal(result.message.includes("[REDACTED]"), true);
  });

  it("formats a stable diagnostics line", () => {
    const result = buildAnalysisFallbackDiagnostics("no ai provider configured");
    const line = formatFallbackDiagnosticsLine(result);
    assert.match(line, /Analysis fallback diagnostics:/);
    assert.match(line, /NO_PROVIDER_CONFIGURED/);
    assert.match(result.nextAction, /ZAI_API_KEY, CEREBRAS_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, TOGETHER_API_KEY, DEEPSEEK_API_KEY, ANTHROPIC_API_KEY/);
  });
});
