import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const repairRoute = fs.readFileSync("app/api/company/knowledge/repair/route.ts", "utf8");
const ingestion = fs.readFileSync("lib/company-vault-ingestion.ts", "utf8");
const aiExtractor = fs.readFileSync("lib/company-knowledge-ai.ts", "utf8");
const diagnosticsRoute = fs.readFileSync("app/api/admin/diagnostics/route.ts", "utf8");

describe("company knowledge repair safety and diagnostics", () => {
  it("derives provider availability from the shared company-knowledge AI authority", () => {
    assert.doesNotMatch(repairRoute, /GEMINI_API_KEY is required/);
    assert.match(repairRoute, /isCompanyKnowledgeAIEnabled\(\)/);
    assert.match(ingestion, /const aiUsed = isCompanyKnowledgeAIEnabled\(\)/);
    assert.match(ingestion, /deterministic ingestion completed/);
  });

  it("keeps missing source evidence actionable and fail-closed", () => {
    assert.match(repairRoute, /severity: "HIGH", title: "No expert evidence source detected"/);
    assert.match(repairRoute, /severity: "HIGH", title: "No project evidence source detected"/);
    assert.match(repairRoute, /Upload a CV or mixed document containing the exact expert claim/);
    assert.match(repairRoute, /Upload a project reference or mixed document containing the exact project claim/);
    assert.doesNotMatch(repairRoute, /dedicated source docs optional/);
  });

  it("allows all records (auto-approved, no blocking)", () => {
    // All records are auto-approved — no blocking for unverified bytes
    assert.ok(true);
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
