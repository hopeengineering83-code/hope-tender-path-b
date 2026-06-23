// AI Analyze Regression Guards
//
// These tests lock in the CONTRACT that the acceptance harness relies on.
// If a future refactor changes the notes marker format, the fallback
// category union, the extraction-status enum, the checkpoint resume logic,
// or the gate codes — these tests will catch it BEFORE the acceptance
// harness breaks.
//
// This file is intentionally separate from the acceptance harness so the
// two can evolve independently: the harness tests BEHAVIOR, the guards
// test STRUCTURE.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf-8");

// ─── Analysis source marker format ───────────────────────────────────────────

describe("REGRESSION: analysis source marker format is stable", () => {
  it("the 'AI' marker uses the exact prefix 'Analysis source: AI'", () => {
    const src = read("lib/engine/analysis-source.ts");
    // The notesIncludeAiAnalysis function uses a regex to match the marker
    assert.match(src, /analysis\s+source:\s*ai/i);
  });

  it("the 'regex fallback' marker uses the exact prefix 'Analysis source: regex fallback'", () => {
    const src = read("lib/engine/analysis-source.ts");
    assert.match(src, /analysis\s+source:\s*regex\s+fallback/i);
  });

  it("the shared canonical builder writes the exact string 'Analysis source: AI (re-run via AI Analyze button).'", () => {
    // The analysis-notes marker now lives in the shared canonical builder used
    // by every analysis path (was previously inline in the route).
    const src = read("lib/engine/canonical-analysis-update.ts");
    assert.match(src, /Analysis source: AI \(re-run via AI Analyze button\)\./);
  });

  it("the run-tender-engine writes 'Analysis source: AI (chunked multi-call when tender > 60K chars).'", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    assert.match(src, /Analysis source: AI \(chunked multi-call when tender > 60K chars\)\./);
  });
});

// ─── AnalysisSource union is stable ──────────────────────────────────────────

describe("REGRESSION: AnalysisSource union members are stable", () => {
  it("AnalysisSource includes exactly AI, REGEX_FALLBACK_AI_ERROR, HUMAN_APPROVED_REGEX_FALLBACK, UNKNOWN", () => {
    const src = read("lib/engine/analysis-source.ts");
    assert.match(src, /"AI"/);
    assert.match(src, /"REGEX_FALLBACK_AI_ERROR"/);
    assert.match(src, /"HUMAN_APPROVED_REGEX_FALLBACK"/);
    assert.match(src, /"UNKNOWN"/);
  });

  it("AnalysisGateResult uses code ANALYSIS_REGEX_FALLBACK_UNAPPROVED", () => {
    const src = read("lib/engine/analysis-source.ts");
    assert.match(src, /code:\s*"ANALYSIS_REGEX_FALLBACK_UNAPPROVED"/);
  });

  it("AnalysisGateResult uses nextAction RUN_ENGINE_OR_APPROVE_ANALYSIS", () => {
    const src = read("lib/engine/analysis-source.ts");
    assert.match(src, /nextAction:\s*"RUN_ENGINE_OR_APPROVE_ANALYSIS"/);
  });
});

// ─── ExtractionStatus enum is stable ─────────────────────────────────────────

describe("REGRESSION: ExtractionStatus enum members are stable", () => {
  it("ExtractionStatus includes the 6 expected statuses", () => {
    const src = read("lib/engine/extraction-quality-gate.ts");
    assert.match(src, /"FULL_EXTRACTION_AI_ANALYZED"/);
    assert.match(src, /"PARTIAL_EXTRACTION_AI_ANALYZED"/);
    assert.match(src, /"OCR_REQUIRED"/);
    assert.match(src, /"EXTRACTION_WEAK_REVIEW_REQUIRED"/);
    assert.match(src, /"REGEX_FALLBACK_FROM_WEAK_EXTRACTION"/);
    assert.match(src, /"EXTRACTION_CORRUPTED_AI_SKIPPED"/);
  });

  it("deriveExtractionStatus returns EXTRACTION_WEAK_REVIEW_REQUIRED for empty file list", () => {
    const src = read("lib/engine/extraction-quality-gate.ts");
    assert.match(src, /if\s*\(files\.length\s*===\s*0\)\s*return\s*"EXTRACTION_WEAK_REVIEW_REQUIRED"/);
  });

  it("deriveExtractionStatus returns EXTRACTION_CORRUPTED_AI_SKIPPED when text is corrupted", () => {
    const src = read("lib/engine/extraction-quality-gate.ts");
    assert.match(src, /return\s*"EXTRACTION_CORRUPTED_AI_SKIPPED"/);
  });
});

// ─── Fallback diagnostics category union is stable ───────────────────────────

describe("REGRESSION: AnalysisFallbackCategory union is stable", () => {
  it("AnalysisFallbackCategory includes the 9 expected categories", () => {
    const src = read("lib/engine/analysis-fallback-diagnostics.ts");
    assert.match(src, /"TIMEOUT"/);
    assert.match(src, /"RATE_LIMIT"/);
    assert.match(src, /"AUTH_OR_ACCESS"/);
    assert.match(src, /"MODEL_UNAVAILABLE"/);
    assert.match(src, /"MALFORMED_AI_JSON"/);
    assert.match(src, /"ALL_PROVIDERS_EXHAUSTED"/);
    assert.match(src, /"AI_PROVIDERS_RATE_LIMITED"/);
    assert.match(src, /"NO_PROVIDER_CONFIGURED"/);
    assert.match(src, /"UNKNOWN_AI_FAILURE"/);
  });

  it("the AI_PROVIDERS_RATE_LIMITED branch comes BEFORE the RATE_LIMIT branch (ordering matters)", () => {
    const src = read("lib/engine/analysis-fallback-diagnostics.ts");
    // Find the BRANCH positions (category: "...") not the type-union positions.
    // The branch that returns AI_PROVIDERS_RATE_LIMITED must appear before
    // the branch that returns RATE_LIMIT.
    const allRateLimitedBranches = [...src.matchAll(/category:\s*"AI_PROVIDERS_RATE_LIMITED"/g)];
    const allRateLimitBranches = [...src.matchAll(/category:\s*"RATE_LIMIT"/g)];
    assert.ok(allRateLimitedBranches.length > 0, "Must have at least one AI_PROVIDERS_RATE_LIMITED branch");
    assert.ok(allRateLimitBranches.length > 0, "Must have at least one RATE_LIMIT branch");
    // Compare the first occurrence of each branch
    assert.ok(allRateLimitedBranches[0].index! < allRateLimitBranches[0].index!,
      "AI_PROVIDERS_RATE_LIMITED branch must come before RATE_LIMIT branch (otherwise the generic rate-limit regex shadows it)");
  });
});

// ─── Checkpoint resume contract is stable ────────────────────────────────────

describe("REGRESSION: checkpoint resume contract is stable", () => {
  it("AiAnalyzeCheckpointProgress type has the 5 expected fields", () => {
    const src = read("lib/ai-analyze-checkpoints.ts");
    assert.match(src, /completedChunks:\s*number/);
    assert.match(src, /totalChunks:\s*number/);
    assert.match(src, /failedChunks:\s*number/);
    assert.match(src, /progressPercent:\s*number/);
    assert.match(src, /resumeAvailable:\s*boolean/);
  });

  it("the unique constraint on AiAnalyzeChunk includes tenderId, userId, contentHash, chunkIndex", () => {
    const src = read("lib/ai-analyze-checkpoints.ts");
    assert.match(src, /tenderId_userId_contentHash_chunkIndex/);
  });

  it("getCompletedChunkResults filters by status === SUCCEEDED", () => {
    const src = read("lib/ai-analyze-checkpoints.ts");
    assert.match(src, /if\s*\(row\.status\s*!==\s*"SUCCEEDED"\)\s*continue/);
  });

  it("resumeAvailable formula is exactly completedChunks > 0 && completedChunks < totalChunks", () => {
    const src = read("lib/ai-analyze-checkpoints.ts");
    assert.match(src, /resumeAvailable:\s*completedChunks\s*>\s*0\s*&&\s*completedChunks\s*<\s*totalChunks/);
  });
});

// ─── Gate codes are stable ───────────────────────────────────────────────────

describe("REGRESSION: generation and export gate codes are stable", () => {
  it("generation gate uses ANALYSIS_REGEX_FALLBACK_UNAPPROVED", () => {
    const src = read("lib/engine/analysis-source.ts");
    assert.match(src, /ANALYSIS_REGEX_FALLBACK_UNAPPROVED/);
  });

  it("final-submission-readiness uses ANALYSIS_REGEX_FALLBACK_UNAPPROVED", () => {
    const src = read("lib/engine/final-submission-readiness.ts");
    assert.match(src, /ANALYSIS_REGEX_FALLBACK_UNAPPROVED/);
  });

  it("export-readiness blocks REGEX_FALLBACK_FROM_WEAK_EXTRACTION", () => {
    const src = read("lib/engine/export-readiness.ts");
    assert.match(src, /REGEX_FALLBACK_FROM_WEAK_EXTRACTION/);
  });

  it("readiness-scoring caps score for each weak extraction status", () => {
    const src = read("lib/engine/readiness-scoring.ts");
    assert.match(src, /EXTRACTION_CORRUPTED_AI_SKIPPED.*capScore:\s*30/);
    assert.match(src, /REGEX_FALLBACK_FROM_WEAK_EXTRACTION.*capScore:\s*40/);
    assert.match(src, /OCR_REQUIRED.*capScore:\s*40/);
    assert.match(src, /PARTIAL_EXTRACTION_AI_ANALYZED.*capScore:\s*50/);
  });
});

// ─── AIRequirement source-traceability fields are stable ─────────────────────

describe("REGRESSION: AIRequirement source-traceability fields are stable", () => {
  it("AIRequirement includes all source-traceability fields", () => {
    const src = read("lib/ai.ts");
    const fields = [
      "sourcePage",
      "sourceQuote",
      "sourceFileName",
      "sourceTenderFileId",
      "sourceExtractionMethod",
      "sourceConfidence",
      "sourceLinkageWarning",
      "sourceSectionHeading",
      "sectionReference",
    ];
    for (const field of fields) {
      assert.match(src, new RegExp(`${field}\\?`), `AIRequirement must include field: ${field}`);
    }
  });

  it("AIAnalysisResult includes tenderTitle", () => {
    const src = read("lib/ai.ts");
    assert.match(src, /tenderTitle\?:\s*string\s*\|\s*null/);
  });
});

// ─── Secret redaction in fallback diagnostics is stable ──────────────────────

describe("REGRESSION: fallback diagnostics redacts secrets", () => {
  it("cleanMessage redacts sk-* keys", () => {
    const src = read("lib/engine/analysis-fallback-diagnostics.ts");
    // The actual pattern is: /sk-[^\s"']{8,}/g
    assert.match(src, /sk-\[/);
  });

  it("cleanMessage redacts AIza* keys", () => {
    const src = read("lib/engine/analysis-fallback-diagnostics.ts");
    assert.match(src, /AIza\[A-Za-z0-9_-\]\{30,\}/);
  });

  it("cleanMessage redacts Bearer tokens", () => {
    const src = read("lib/engine/analysis-fallback-diagnostics.ts");
    assert.match(src, /Bearer\\s\+/);
  });

  it("cleanMessage truncates to 300 chars", () => {
    const src = read("lib/engine/analysis-fallback-diagnostics.ts");
    assert.match(src, /\.slice\(0,\s*300\)/);
  });
});

// ─── AI Analyze route strips old markers before writing new ones ─────────────

describe("REGRESSION: AI Analyze strips old markers before writing new ones", () => {
  // The notes-stripping logic now lives in buildAnalysisNotes() inside the
  // shared canonical builder, used by every analysis path.
  it("the shared builder filters out old 'Analysis source:' lines", () => {
    const src = read("lib/engine/canonical-analysis-update.ts");
    assert.match(src, /\/\^Analysis source:\//i);
  });

  it("the shared builder filters out old 'Analysis fallback diagnostics:' lines", () => {
    const src = read("lib/engine/canonical-analysis-update.ts");
    assert.match(src, /\/\^Analysis fallback diagnostics:\//i);
  });
});
