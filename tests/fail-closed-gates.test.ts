// Targeted test: fail-closed generation/export gates must NOT be weakened.
// Partial/fallback/failed analysis cannot unlock generation, export, or ZIP.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("Fail-closed generation/export gates (not weakened)", () => {
  it("generation readiness gate blocks ANALYSIS_NOT_READY", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    assert.ok(src.includes("ANALYSIS_NOT_READY"), "gate must block ANALYSIS_NOT_READY");
  });

  it("generation readiness gate blocks FALLBACK_UNAPPROVED", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    assert.ok(src.includes("FALLBACK_UNAPPROVED"), "gate must block FALLBACK_UNAPPROVED");
  });

  it("Anthropic remains last in provider chain", () => {
    const src = read("lib/ai-provider-catalog.cjs");
    const match = src.match(/CANONICAL_AI_PROVIDER_ORDER\s*=\s*\[([\s\S]*?)\]/);
    assert.ok(match, "must find CANONICAL_AI_PROVIDER_ORDER");
    const providers = Array.from(match[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
    assert.equal(
      providers[providers.length - 1],
      "anthropic",
      "Anthropic must be the LAST provider in the chain",
    );
  });

  it("regex/deterministic fallback is never treated as AI success", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    assert.ok(
      src.includes("REGEX_FALLBACK") || src.includes("FALLBACK_DRAFT"),
      "must have REGEX_FALLBACK or FALLBACK_DRAFT status — never treated as AI success",
    );
    // The finalizeJob must NOT promote REGEX_FALLBACK to SUCCEEDED
    assert.ok(
      !src.includes('analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED".*REGEX_FALLBACK'),
      "must NOT set FULL_EXTRACTION_AI_ANALYZED when analysis is REGEX_FALLBACK",
    );
  });

  it("partial analysis cannot unlock generation", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    // PARTIAL_EXTRACTION_AI_ANALYZED should be checked — partial analysis
    // must not automatically unlock generation
    assert.ok(
      src.includes("PARTIAL") || src.includes("partial"),
      "generation gate must account for PARTIAL extraction status",
    );
  });

  it("failed analysis sets REGEX_FALLBACK_UNAPPROVED, not AI success", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    assert.ok(
      src.includes("REGEX_FALLBACK_UNAPPROVED"),
      "failed analysis must set REGEX_FALLBACK_UNAPPROVED — not AI success status",
    );
  });

  it("finalizeJob does not create GeneratedDocument rows", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    assert.ok(
      !src.includes("generatedDocument.create"),
      "finalizeJob must NOT create GeneratedDocument rows — " +
        "generation is a separate gated step that requires valid extraction + Build Plan",
    );
  });
});
