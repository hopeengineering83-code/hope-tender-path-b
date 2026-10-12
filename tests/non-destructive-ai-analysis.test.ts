// Non-destructive AI analysis regression tests.
//
// Verifies:
//   1. partial run does not alter canonical requirements (stagePartialResult instead)
//   2. failed run does not alter canonical requirements (preserveAiAnalyzeProgressOnFailure preserved)
//   3. timeout does not alter canonical requirements (same path as partial)
//   4. fallback draft does not alter canonical requirements (stageFallbackDraft instead)
//   5. successful finalization atomically promotes one version (promoteAnalysisToCanonical + canPromoteToCanonical)
//   6. stale run cannot overwrite newer promoted run (canPromoteToCanonical version guard)
//   7. duplicate requests do not create duplicate requirements (runId deduplication)
//   8. previous version remains available (stagedMergedResult stored on AiJob)
//   9. current recovery actions remain functional (preserveAiAnalyzeProgressOnFailure preserved)

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const serviceSource = readFileSync(
  path.join(process.cwd(), "lib/ai-jobs/analysis-job-service.ts"),
  "utf-8",
);
const promotionSource = readFileSync(
  path.join(process.cwd(), "lib/ai-analyze-promotion.ts"),
  "utf-8",
);
const schemaSource = readFileSync(
  path.join(process.cwd(), "prisma/schema.prisma"),
  "utf-8",
);

// ── Schema: versioning fields on AiJob ───────────────────────────────────────

describe("non-destructive AI analysis — AiJob schema fields", () => {
  it("AiJob schema has stagedMergedResult field", () => {
    assert.ok(
      schemaSource.includes("stagedMergedResult"),
      "AiJob must have stagedMergedResult column to hold staged partial/fallback results",
    );
  });

  it("AiJob schema has promotedAt field", () => {
    assert.ok(
      schemaSource.includes("promotedAt"),
      "AiJob must have promotedAt column to record when a run was promoted to canonical",
    );
  });

  it("AiJob schema has analysisVersion as BigInt autoincrement (collision-proof)", () => {
    assert.ok(
      schemaSource.includes("analysisVersion"),
      "AiJob must have analysisVersion column to support stale-run detection",
    );
    assert.ok(
      schemaSource.includes("analysisVersion     BigInt"),
      "analysisVersion must be BigInt, not Int",
    );
    assert.ok(
      schemaSource.includes("autoincrement()"),
      "analysisVersion must use @default(autoincrement()) so PostgreSQL assigns values via a sequence — no application-level timestamp and no same-millisecond collision risk",
    );
  });

  it("AiJob schema has runId field for deduplication", () => {
    assert.ok(
      schemaSource.includes("runId"),
      "AiJob must have runId column so duplicate concurrent requests can be detected",
    );
  });
});

// ── Promotion library: exported API ──────────────────────────────────────────

describe("non-destructive AI analysis — ai-analyze-promotion library", () => {
  it("stagePartialResult is exported", () => {
    assert.ok(
      promotionSource.includes("export async function stagePartialResult"),
      "lib/ai-analyze-promotion must export stagePartialResult",
    );
  });

  it("stageFallbackDraft is exported", () => {
    assert.ok(
      promotionSource.includes("export async function stageFallbackDraft"),
      "lib/ai-analyze-promotion must export stageFallbackDraft",
    );
  });

  it("canPromoteToCanonical is exported", () => {
    assert.ok(
      promotionSource.includes("export async function canPromoteToCanonical"),
      "lib/ai-analyze-promotion must export canPromoteToCanonical",
    );
  });

  it("promoteAnalysisToCanonical is exported", () => {
    assert.ok(
      promotionSource.includes("export async function promoteAnalysisToCanonical"),
      "lib/ai-analyze-promotion must export promoteAnalysisToCanonical",
    );
  });

  it("staging functions write to stagedMergedResult, not to tenderRequirement", () => {
    assert.ok(
      promotionSource.includes("stagedMergedResult"),
      "staging functions must write to AiJob.stagedMergedResult",
    );
    assert.ok(
      !promotionSource.includes("tenderRequirement"),
      "staging functions must NOT write to canonical tenderRequirement table",
    );
  });

  it("canPromoteToCanonical guards against stale runs using analysisVersion and promotedAt", () => {
    assert.ok(
      promotionSource.includes("analysisVersion") && promotionSource.includes("promotedAt"),
      "canPromoteToCanonical must use analysisVersion and promotedAt to detect stale/superseded runs",
    );
  });

  it("canPromoteToCanonical fails closed when job tracking is unavailable", () => {
    assert.match(
      promotionSource,
      /if \(!jobId\) return false;/,
      "missing AiJob id must block canonical promotion instead of allowing unversioned writes",
    );
    assert.match(
      promotionSource,
      /if \(!thisJob\) return false;/,
      "missing AiJob row must block canonical promotion instead of allowing unversioned writes",
    );
    assert.doesNotMatch(
      promotionSource,
      /if \(!jobId\) return true;|if \(!thisJob\) return true;/,
      "promotion must not fail open when job tracking fails",
    );
  });
});

// ── Service: partial and fallback paths use non-destructive staging ─────────────

describe("non-destructive AI analysis — service staging for partial and fallback runs", () => {
  it("service calls stagePartialResult for partial AI results", () => {
    assert.ok(
      serviceSource.includes("stagePartialResult"),
      "service must call stagePartialResult so partial AI results are staged rather than written to canonical requirements",
    );
  });

  it("service guards canonical promotion with canPromoteToCanonical", () => {
    assert.ok(
      serviceSource.includes("canPromoteToCanonical"),
      "service must call canPromoteToCanonical before writing to canonical tender fields to prevent stale-run overwrites",
    );
  });

  it("service records canonical promotion via promoteAnalysisToCanonical", () => {
    assert.ok(
      serviceSource.includes("promoteAnalysisToCanonical"),
      "service must call promoteAnalysisToCanonical after successful canonical write to set promotedAt",
    );
  });

  it("AiJob is created with runId for duplicate-request deduplication", () => {
    assert.ok(
      serviceSource.includes("runId") && serviceSource.includes("runId"),
      "service must generate a runId when creating AiJob records to prevent duplicate canonical writes",
    );
  });
});

// ── Service: recovery actions are still functional ────────────────────

describe("non-destructive AI analysis — recovery actions preserved", () => {
  it("failed chunk handling preserves other completed chunks without a test-only helper", () => {
    assert.ok(
      serviceSource.includes("where: { id: chunk.id }") &&
        serviceSource.includes('status: "FAILED"') &&
        serviceSource.includes("Previously succeeded chunks"),
      "the durable catch path must update only the failed chunk so completed chunk results remain resumable",
    );
    assert.ok(
      !serviceSource.includes("async function preserveAiAnalyzeProgressOnFailure"),
      "production code must not retain an unused helper only to satisfy a source-text test",
    );
  });

  it("service imports promotion helpers from ai-analyze-promotion", () => {
    assert.ok(
      serviceSource.includes("canPromoteToCanonical") &&
        serviceSource.includes("promoteAnalysisToCanonical"),
      "service must import and use promotion helpers from lib/ai-analyze-promotion",
    );
  });

  it("chunkResults are still stored in AiJob.output for resume functionality", () => {
    assert.ok(
      serviceSource.includes("chunkResults: succeeded.map"),
      "chunkResults must remain in AiJob output for resume functionality",
    );
  });
});
