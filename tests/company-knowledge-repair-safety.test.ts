import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const repairRoute = fs.readFileSync("app/api/company/knowledge/repair/route.ts", "utf8");
const aiExtractor = fs.readFileSync("lib/company-knowledge-ai.ts", "utf8");
const diagnosticsRoute = fs.readFileSync("app/api/admin/diagnostics/route.ts", "utf8");

describe("company knowledge repair safety copy and diagnostics", () => {
  it("lists all 10 providers (not just Gemini)", () => {
    assert.ok(!/GEMINI_API_KEY is required/.test(repairRoute));
    assert.match(repairRoute, /ZAI_API_KEY, CEREBRAS_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, TOGETHER_API_KEY, DEEPSEEK_API_KEY, or ANTHROPIC_API_KEY/);
    assert.match(repairRoute, /emergency-only last resort/);
  });

  it("downgrades missing dedicated CV/project docs to LOW when reviewed records exist", () => {
    assert.match(repairRoute, /severity: "LOW", title: "No dedicated expert source documents detected"/);
    assert.match(repairRoute, /severity: "LOW", title: "No dedicated project source documents detected"/);
    assert.match(repairRoute, /Reviewed records available; dedicated source docs optional/);
  });

  it("sanitizes provider errors before storing extraction warnings", () => {
    assert.match(aiExtractor, /function sanitizeProviderMessage/);
    assert.match(aiExtractor, /\[REDACTED_KEY\]/);
    assert.match(aiExtractor, /sanitizeProviderMessage\(error instanceof Error/);
  });

  it("admin diagnostics does not select full CompanyDocument extractedText for counts", () => {
    assert.ok(!/documents:\s*\{\s*select:\s*\{[^}]*extractedText:\s*true/s.test(diagnosticsRoute));
    assert.match(diagnosticsRoute, /char_length\("extractedText"\)/);
    assert.match(diagnosticsRoute, /docTextLengthById/);
  });
});
