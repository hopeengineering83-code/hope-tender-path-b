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

  // This previously asserted nothing (`assert.ok(true)`) under the claim "all
  // records are auto-approved — no blocking for unverified bytes". That claim
  // is also stale: the repair route does NOT auto-approve, and unverified bytes
  // ARE surfaced. Assert the behaviour that actually exists and must be kept.
  it("does not auto-approve records and surfaces unrecoverable source bytes", () => {
    // A record may claim REVIEWED/SOURCE_VERIFIED, but the route re-derives
    // trust from durable provenance rather than trusting the stored label.
    assert.match(
      repairRoute,
      /trustLevel === "REVIEWED" && !isDurablyReviewed\(record\)/,
      "REVIEWED records without durable provenance must be counted as unsupported",
    );
    assert.match(
      repairRoute,
      /trustLevel === "SOURCE_VERIFIED" && !isDurablySourceVerified\(record\)/,
      "SOURCE_VERIFIED records without durable provenance must be counted as unsupported",
    );
    // Documents whose original bytes no longer exist must be reported as such,
    // not silently treated as healthy.
    assert.match(
      repairRoute,
      /integrityFailureCode === "SOURCE_BYTES_UNAVAILABLE"/,
      "unrecoverable source bytes must be detected explicitly",
    );
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
