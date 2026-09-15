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
  it("the 'AI' marker uses the ANCHORED, word-bounded regex /^analysis\\s+source:\\s*ai\\b/im", () => {
    const src = read("lib/engine/analysis-source.ts");
    // Root Cause #3 fix: the regex MUST be anchored (^ + m flag) and
    // word-bounded (\b) so that "REGEX_FALLBACK_AI_ERROR" in notes
    // cannot be misread as an AI success marker. The loose form
    // /analysis\s+source:\s*ai/i is FORBIDDEN as a live regex.
    assert.match(src, /\/\^analysis\\s\+source:\\s\*ai\\b\/im/);
  });

  it("the 'AI' marker function body does NOT use the loose unanchored regex", () => {
    const src = read("lib/engine/analysis-source.ts");
    // Root Cause #3 fix: the LIVE regex in notesIncludeAiAnalysis must
    // be anchored (^) and word-bounded (\b) with the m flag. Comments
    // may mention the legacy form for context, but the actual
    // `return /.../.test(...)` must be anchored.
    const fnStart = src.indexOf("function notesIncludeAiAnalysis");
    assert.ok(fnStart > -1, "notesIncludeAiAnalysis function must exist");
    const fnEnd = src.indexOf("}", fnStart);
    const fnBody = src.slice(fnStart, fnEnd);
    const returnLine = fnBody.match(/return\s+(\/[^\s]+\.test)/);
    assert.ok(returnLine, "notesIncludeAiAnalysis must have a return /regex/.test() call");
    const liveRegex = returnLine[1];
    // Must start with /^ (anchored) and end with \b/im (word-bounded + multiline)
    assert.match(liveRegex, /\/\^/, "the live AI-marker regex must be anchored with /^");
    assert.match(liveRegex, /\\b\/[a-z]*m/, "the live AI-marker regex must end with \\b and include the m flag");
  });

  it("the 'regex fallback' marker uses the ANCHORED, word-bounded regex", () => {
    const src = read("lib/engine/analysis-source.ts");
    assert.match(src, /\/\^analysis\\s\+source:\\s\*regex\\s\+fallback\\b\/im/);
  });

  it("the 'regex fallback' marker function body does NOT use the loose unanchored regex", () => {
    const src = read("lib/engine/analysis-source.ts");
    const fnStart = src.indexOf("function notesIncludeRegexFallback");
    assert.ok(fnStart > -1, "notesIncludeRegexFallback function must exist");
    const fnEnd = src.indexOf("}", fnStart);
    const fnBody = src.slice(fnStart, fnEnd);
    const returnLine = fnBody.match(/return\s+(\/[^\s]+\.test)/);
    assert.ok(returnLine, "notesIncludeRegexFallback must have a return /regex/.test() call");
    const liveRegex = returnLine[1];
    assert.match(liveRegex, /\/\^/, "the live regex-fallback regex must be anchored with /^");
    assert.match(liveRegex, /\\b\/[a-z]*m/, "the live regex-fallback regex must end with \\b and include the m flag");
  });

  it("the shared canonical builder writes an AI analysis source marker", () => {
    // The analysis-notes marker now lives in the shared canonical builder used
    // by every analysis path (was previously inline in the route).
    const src = read("lib/engine/canonical-analysis-update.ts");
    assert.match(src, /Analysis source: AI/);
  });

  it("the run-tender-engine writes an AI analysis source marker", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    assert.match(src, /Analysis source:.*AI/);
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
  // These asserted that specific regex LITERALS appeared in the source. That
  // pinned one implementation of redaction rather than redaction itself, and it
  // failed the moment the three inline patterns were replaced by the shared
  // redactor — which covers strictly more key formats than they did. Asserting
  // the behaviour instead is both stronger and survives the delegation.
  const SECRETS: ReadonlyArray<readonly [string, string]> = [
    ["Anthropic", "sk-ant-api03-" + "realkey1234567890abcdefghijklmnop"],
    ["OpenAI", "sk-" + "proj1234567890abcdefghijklmnopqrst"],
    ["Gemini (legacy)", "AIza" + "SyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"],
    ["Gemini (new)", "AQ" + "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8"],
    ["Groq", "gsk_" + "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0"],
    ["Cerebras", "csk_" + "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0"],
    ["DeepSeek", "dsk-" + "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0"],
  ];

  for (const [label, secret] of SECRETS) {
    it(`removes a ${label} key from the operator-facing message`, async () => {
      const { buildAnalysisFallbackDiagnostics } = await import("../lib/engine/analysis-fallback-diagnostics");
      const { message } = buildAnalysisFallbackDiagnostics(`Auth error: ${secret}`);
      assert.ok(!message.includes(secret), `${label} key must not survive into the message`);
      assert.match(message, /REDACTED/);
    });
  }

  it("redacts a Bearer token", async () => {
    const { buildAnalysisFallbackDiagnostics } = await import("../lib/engine/analysis-fallback-diagnostics");
    const { message } = buildAnalysisFallbackDiagnostics("Authorization: Bearer abc123def456ghi789");
    assert.ok(!message.includes("abc123def456ghi789"));
  });

  it("truncates the message so a huge provider body cannot flood the surface", async () => {
    const { buildAnalysisFallbackDiagnostics } = await import("../lib/engine/analysis-fallback-diagnostics");
    const { message } = buildAnalysisFallbackDiagnostics("x".repeat(5_000));
    assert.ok(message.length <= 300, `expected <= 300 chars, got ${message.length}`);
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
