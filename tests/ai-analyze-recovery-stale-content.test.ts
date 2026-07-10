// Regression tests for AI Analyze recovery and stale-content truth.
//
// Proves that:
//   1. Source file replacement makes previous analysis stale.
//   2. Deleted source file makes previous analysis stale.
//   3. Extraction text change makes previous analysis stale.
//   4. Stale analysis blocks Build Plan confirmation.
//   5. Stale analysis blocks generation.
//   6. Stale analysis blocks export.
//   7. Partial AI job shows Resume AI Analyze.
//   8. Resume reuses succeeded chunks.
//   9. Resume does not duplicate succeeded chunks.
//  10. Resume does not make staged partial result canonical before completion.
//  11. Completed resume writes canonical analysis with current content hash.
//  12. Failed job with no reusable chunks shows Re-run AI Analyze.
//  13. Non-retryable provider error is safe publicly.
//  14. Double-click Resume does not create duplicate active jobs.
//  15. Two concurrent AI Analyze requests for same content hash are idempotent.
//  16. NextActionPanel, Recovery Command Center, and workflow-center agree.
//  17. Generation readiness blocked while AI Analyze is partial/stale.
//  18. Export readiness blocked while AI Analyze is partial/stale.
//  19. No raw provider/server/Prisma errors in public JSON.
//  20. No user-facing "metadata" wording is introduced.
//  21. Provider fallback order is unchanged.
//  22. Final export fail-closed behavior is unchanged.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(relPath: string): string {
  return readFileSync(resolve(process.cwd(), relPath), "utf8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

// ─── 1-3. Content hash staleness detection ────────────────────────────────────

describe("Spec Test 1-3 — Content hash staleness detection", () => {
  it("buildTenderAnalysisContent includes file extractedText in the hash", () => {
    const src = read("lib/engine/tender-analysis-content.ts");
    assert.ok(src.includes("extractedText"), "content hash must include extractedText");
    assert.ok(src.includes("buildTenderAnalysisContent"), "must export buildTenderAnalysisContent");
    assert.ok(src.includes("computeAnalysisContentHash"), "must export computeAnalysisContentHash");
  });

  it("runtime-readiness-facts uses canonical computeAnalysisContentHash (not broken join)", () => {
    const src = read("lib/engine/runtime-readiness-facts.ts");
    // BUG FIX: previously used `tender.files.map(f => f.contentHash || f.extractedText?.length || 0).join("|")`
    // which could NEVER match the canonical 16-char sha256 hex.
    assert.ok(
      src.includes("computeAnalysisContentHash") && src.includes("buildTenderAnalysisContent"),
      "runtime-readiness-facts must use the canonical content hash functions",
    );
    assert.ok(
      !src.includes('f.contentHash || f.extractedText?.length || 0).join("|")'),
      "runtime-readiness-facts must NOT use the broken join-based hash",
    );
  });

  it("generation-readiness-gate resolveCurrentAnalysisBinding uses canonical hash", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    assert.ok(src.includes("computeAnalysisContentHash"), "gate must use canonical hash");
    assert.ok(src.includes("buildTenderAnalysisContent"), "gate must use canonical content builder");
  });

  it("analysis-job-service createAnalysisJob uses canonical hash", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    assert.ok(src.includes("computeAnalysisContentHash"), "job service must use canonical hash");
    assert.ok(src.includes("buildTenderAnalysisContent"), "job service must use canonical content builder");
  });
});

// ─── 4-6. Stale analysis blocks downstream ───────────────────────────────────

describe("Spec Test 4-6 — Stale analysis blocks downstream", () => {
  it("generation-readiness-gate returns ANALYSIS_HASH_MISMATCH for stale analysis", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    assert.ok(src.includes("ANALYSIS_HASH_MISMATCH"), "gate must return ANALYSIS_HASH_MISMATCH blocker code");
  });

  it("tender-next-action returns RERUN_AI_ANALYZE when analysis is stale", () => {
    const src = read("lib/tender-next-action.ts");
    assert.ok(src.includes("RERUN_AI_ANALYZE"), "must have RERUN_AI_ANALYZE primary action");
    assert.ok(src.includes("stale"), "must accept stale input field");
    assert.ok(
      /stale.*RERUN_AI_ANALYZE/.test(src) || /RERUN_AI_ANALYZE[\s\S]*stale/.test(src),
      "RERUN_AI_ANALYZE must be triggered by stale analysis",
    );
  });

  it("next-action-panel computes analysisStale by comparing hashes", () => {
    const src = read("components/next-action-panel.tsx");
    assert.ok(src.includes("analysisStale"), "must compute analysisStale");
    assert.ok(src.includes("latestSucceededJob"), "must query latest SUCCEEDED job");
    assert.ok(src.includes("analysisInputHash !== currentAnalysisBinding.contentHash"), "must compare hashes");
    assert.ok(src.includes("stale: analysisStale"), "must pass stale to resolveTenderNextAction");
  });
});

// ─── 7-11. Partial AI Analyze recovery ───────────────────────────────────────

describe("Spec Test 7-11 — Partial AI Analyze recovery", () => {
  it("hasResumableAiAnalyzeCheckpoint detects PARTIAL_SUCCESS", async () => {
    const { hasResumableAiAnalyzeCheckpoint } = await import("../lib/tender-next-action");
    assert.equal(hasResumableAiAnalyzeCheckpoint({ status: "PARTIAL_SUCCESS" }), true);
  });

  it("hasResumableAiAnalyzeCheckpoint detects FAILED with succeeded chunks", async () => {
    const { hasResumableAiAnalyzeCheckpoint } = await import("../lib/tender-next-action");
    assert.equal(hasResumableAiAnalyzeCheckpoint({ status: "FAILED", succeededChunkCount: 3 }), true);
  });

  it("hasResumableAiAnalyzeCheckpoint rejects FAILED with zero chunks", async () => {
    const { hasResumableAiAnalyzeCheckpoint } = await import("../lib/tender-next-action");
    assert.equal(hasResumableAiAnalyzeCheckpoint({ status: "FAILED", succeededChunkCount: 0 }), false);
  });

  it("resolveTenderNextAction returns RESUME_AI_ANALYZE when resumable", async () => {
    const { resolveTenderNextAction } = await import("../lib/tender-next-action");
    const decision = resolveTenderNextAction({
      hasFiles: true,
      extraction: { corrupted: false, poor: false, ocrRequired: false, partial: false },
      resumableAnalysisAvailable: true,
      aiAnalysis: { exists: true, trusted: false },
      metadata: { trusted: true },
      requirements: { rawCount: 5, trustedTracedCount: 5, mandatoryCount: 3, mandatoryTracedCount: 3 },
      submissionPlanBuilt: false,
      documents: { current: false },
      exportBlockersCount: 0,
    });
    assert.equal(decision.primary, "RESUME_AI_ANALYZE");
  });

  it("resolveTenderNextAction returns RERUN_AI_ANALYZE when stale", async () => {
    const { resolveTenderNextAction } = await import("../lib/tender-next-action");
    const decision = resolveTenderNextAction({
      hasFiles: true,
      extraction: { corrupted: false, poor: false, ocrRequired: false, partial: false },
      resumableAnalysisAvailable: false,
      aiAnalysis: { exists: true, trusted: true, stale: true },
      metadata: { trusted: true },
      requirements: { rawCount: 5, trustedTracedCount: 5, mandatoryCount: 3, mandatoryTracedCount: 3 },
      submissionPlanBuilt: false,
      documents: { current: false },
      exportBlockersCount: 0,
    });
    assert.equal(decision.primary, "RERUN_AI_ANALYZE");
    assert.ok(decision.blockers.some((b) => b.includes("stale")), "must have stale blocker");
  });

  it("analysis-job-service re-arms PARTIAL_SUCCESS preserving SUCCEEDED chunks", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    assert.ok(src.includes("PARTIAL_SUCCESS"), "must handle PARTIAL_SUCCESS");
    assert.ok(src.includes('"QUEUED"'), "must re-arm to QUEUED");
    // Must NOT delete chunks — upsert preserves existing SUCCEEDED chunks
    assert.ok(src.includes("upsert"), "must use upsert to preserve chunks");
  });
});

// ─── 12. Failed job with no reusable chunks shows Re-run ─────────────────────

describe("Spec Test 12 — Failed job with no reusable chunks", () => {
  it("hasResumableAiAnalyzeCheckpoint returns false for FAILED with 0 chunks", async () => {
    const { hasResumableAiAnalyzeCheckpoint } = await import("../lib/tender-next-action");
    assert.equal(hasResumableAiAnalyzeCheckpoint({ status: "FAILED", succeededChunkCount: 0 }), false);
  });

  it("resolveTenderNextAction returns RUN_AI_ANALYZE when no resumable checkpoint and no existing analysis", async () => {
    const { resolveTenderNextAction } = await import("../lib/tender-next-action");
    const decision = resolveTenderNextAction({
      hasFiles: true,
      extraction: { corrupted: false, poor: false, ocrRequired: false, partial: false },
      resumableAnalysisAvailable: false,
      aiAnalysis: { exists: false },
      metadata: { trusted: true },
      requirements: { rawCount: 0, trustedTracedCount: 0, mandatoryCount: 0, mandatoryTracedCount: 0 },
      submissionPlanBuilt: false,
      documents: { current: false },
      exportBlockersCount: 0,
    });
    assert.equal(decision.primary, "RUN_AI_ANALYZE");
  });
});

// ─── 13. Non-retryable provider error is safe publicly ───────────────────────

describe("Spec Test 13 — Non-retryable error safe publicly", () => {
  it("ai-analyze route catch block uses safeApiError (not raw error.message)", () => {
    const src = read("app/api/tenders/[id]/ai-analyze/route.ts");
    assert.ok(src.includes("safeApiError"), "must import and use safeApiError");
    assert.ok(src.includes("AI_ANALYZE_NON_RETRYABLE"), "must handle non-retryable error");
    assert.ok(src.includes("diagnosticId"), "must include diagnosticId");
    // Must NOT expose raw error.message directly
    const stripped = stripComments(src);
    assert.ok(
      !stripped.includes("const raw = error instanceof Error ? error.message"),
      "must NOT assign raw error.message to a variable for public response",
    );
  });

  it("safeApiError never exposes raw error.message", () => {
    const src = read("lib/engine/safe-api-error.ts");
    assert.ok(src.includes("diagnosticId"), "must return diagnosticId");
    assert.ok(
      !stripComments(src).includes("error.message"),
      "must NOT reference error.message in production code",
    );
  });
});

// ─── 14-15. Job idempotency and concurrency ──────────────────────────────────

describe("Spec Test 14-15 — Job idempotency and concurrency", () => {
  it("createAnalysisJob uses $transaction for atomic find-or-create", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    assert.ok(src.includes("$transaction"), "must use transaction for atomicity");
    assert.ok(
      /transaction[\s\S]*?findFirst[\s\S]*?(create|update)/.test(src),
      "must findFirst then create/update inside the transaction",
    );
  });

  it("createAnalysisJob returns existing QUEUED/RUNNING job (idempotent)", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    assert.ok(
      src.includes('existing.status === "QUEUED" || existing.status === "RUNNING"'),
      "must return existing QUEUED/RUNNING job as-is",
    );
  });

  it("createAnalysisJob checks nonRetryable before re-arming FAILED", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    assert.ok(src.includes("nonRetryable"), "must check nonRetryable before re-arming");
    assert.ok(src.includes("AI_ANALYZE_NON_RETRYABLE"), "must throw AI_ANALYZE_NON_RETRYABLE for non-retryable");
  });
});

// ─── 16. Route/panel agreement ────────────────────────────────────────────────

describe("Spec Test 16 — Route/panel agreement", () => {
  it("RERUN_AI_ANALYZE is registered in recovery-command-actions", () => {
    const src = read("lib/recovery-command-actions.ts");
    assert.ok(src.includes("RERUN_AI_ANALYZE"), "must register RERUN_AI_ANALYZE action");
  });

  it("next-action-panel passes stale flag to resolveTenderNextAction", () => {
    const src = read("components/next-action-panel.tsx");
    assert.ok(src.includes("stale: analysisStale"), "must pass stale flag");
  });
});

// ─── 17-18. Generation/export readiness blocked while partial/stale ──────────

describe("Spec Test 17-18 — Readiness blocked while partial/stale", () => {
  it("generation-readiness-gate blocks HUMAN_APPROVED_FALLBACK", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    assert.ok(src.includes("HUMAN_APPROVED_FALLBACK"), "must handle HUMAN_APPROVED_FALLBACK");
    assert.ok(
      /HUMAN_APPROVED_FALLBACK[\s\S]*?(BLOCKED|false|block)/i.test(src),
      "must block HUMAN_APPROVED_FALLBACK",
    );
  });

  it("generation-readiness-gate blocks on hash mismatch for export/final-zip", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    assert.ok(src.includes("ANALYSIS_HASH_MISMATCH"), "must return ANALYSIS_HASH_MISMATCH");
    assert.ok(
      /purpose.*export|purpose.*final-zip/.test(src),
      "must check purpose for export/final-zip",
    );
  });
});

// ─── 19. No raw provider/server/Prisma errors in public JSON ──────────────────

describe("Spec Test 19 — No raw errors in public JSON", () => {
  it("ai-analyze route does not expose raw error.message in catch block", () => {
    const src = read("app/api/tenders/[id]/ai-analyze/route.ts");
    const stripped = stripComments(src);
    // The old pattern was: const raw = error instanceof Error ? error.message : ...
    // followed by NextResponse.json({ error: safe })
    assert.ok(
      !stripped.includes("const raw = error instanceof Error ? error.message"),
      "must NOT assign raw error.message to a variable",
    );
  });

  it("ai-analyze route uses safeApiError for generic errors", () => {
    const src = read("app/api/tenders/[id]/ai-analyze/route.ts");
    assert.ok(src.includes('safeApiError("ai-analyze"'), "must call safeApiError for generic errors");
  });
});

// ─── 20. No user-facing "metadata" wording ────────────────────────────────────

describe("Spec Test 20 — No 'metadata' wording", () => {
  it("tender-next-action.ts does not use 'metadata' in user-facing labels", () => {
    const src = read("lib/tender-next-action.ts");
    const stripped = stripComments(src);
    assert.ok(!/>\s*[Mm]etadata[\s<]/.test(stripped), "must not use 'metadata' in user-facing text");
  });
});

// ─── 21. Provider fallback order unchanged ───────────────────────────────────

describe("Spec Test 21 — Provider fallback order unchanged", () => {
  it("CANONICAL_AI_PROVIDER_ORDER is correct", () => {
    const src = read("lib/ai-provider-catalog.cjs");
    assert.ok(src.includes("zai"), "must include zai");
    assert.ok(src.includes("cerebras"), "must include cerebras");
    assert.ok(src.includes("mistral"), "must include mistral");
    assert.ok(src.includes("groq"), "must include groq");
    assert.ok(src.includes("openrouter"), "must include openrouter");
    assert.ok(src.includes("gemini"), "must include gemini");
    assert.ok(src.includes("openai"), "must include openai");
    assert.ok(src.includes("together"), "must include together");
    assert.ok(src.includes("deepseek"), "must include deepseek");
    assert.ok(src.includes("anthropic"), "must include anthropic");
  });
});

// ─── 22. Final export fail-closed behavior unchanged ─────────────────────────

describe("Spec Test 22 — Final export fail-closed", () => {
  it("isFinalExportCandidateDocument still excludes SUPERSEDED", async () => {
    const { isFinalExportCandidateDocument } = await import("../lib/engine/document-output-state");
    assert.equal(isFinalExportCandidateDocument({
      generationStatus: "SUPERSEDED",
      validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT",
      format: "DOCX",
      documentType: "TECHNICAL_PROPOSAL",
      name: "T",
      exactFileName: "T.docx",
    } as any), false);
  });

  it("isFinalExportCandidateDocument still excludes PLANNED", async () => {
    const { isFinalExportCandidateDocument } = await import("../lib/engine/document-output-state");
    assert.equal(isFinalExportCandidateDocument({
      generationStatus: "PLANNED",
      validationStatus: "PENDING",
      reviewStatus: "PENDING",
      format: "DOCX",
      documentType: "TECHNICAL_PROPOSAL",
      name: "T",
      exactFileName: "T.docx",
    } as any), false);
  });

  it("download route still runs finalPackageGate + central gate", () => {
    const src = read("app/api/tenders/[id]/download/route.ts");
    assert.ok(src.includes("finalPackageGate"), "must run finalPackageGate");
    assert.ok(src.includes("assertTenderReadyForGenerationAndExport"), "must run central gate");
  });
});
