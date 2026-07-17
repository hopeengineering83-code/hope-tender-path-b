import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const repairRoute = fs.readFileSync("app/api/company/knowledge/repair/route.ts", "utf8");
const aiExtractor = fs.readFileSync("lib/company-knowledge-ai.ts", "utf8");
const diagnosticsRoute = fs.readFileSync("app/api/admin/diagnostics/route.ts", "utf8");

describe("company knowledge repair safety copy and diagnostics", () => {
  it("derives provider availability from the shared company-knowledge AI authority", () => {
    assert.ok(!/GEMINI_API_KEY is required/.test(repairRoute));
    assert.match(repairRoute, /isCompanyKnowledgeAIEnabled\(\)/);
    assert.match(repairRoute, /AI extraction is not enabled/);
    assert.match(repairRoute, /approved AI provider/);
  });

  it("keeps missing source documents fail-closed under durable provenance authority", () => {
    assert.match(repairRoute, /severity: "HIGH", title: "No expert source documents detected"/);
    assert.match(repairRoute, /severity: "HIGH", title: "No project source documents detected"/);
    assert.match(repairRoute, /Expert records cannot become usable without an owned CV\/staff source document and field evidence/);
    assert.match(repairRoute, /Project records cannot become usable without an owned project-reference source document and field evidence/);
    assert.doesNotMatch(repairRoute, /dedicated source docs optional/);
  });

  it("blocks unverified bytes and reviews without durable provenance", () => {
    assert.match(repairRoute, /Source byte integrity is unverified/);
    assert.match(repairRoute, /Expert reviews lack durable provenance/);
    assert.match(repairRoute, /Project reviews lack durable provenance/);
    assert.match(repairRoute, /isDurablyReviewed/);
    assert.match(repairRoute, /sourceByteIntegrityIsVerified/);
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
