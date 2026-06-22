// Durable AI Analyze checkpoint regression tests.
//
// These tests verify the source-level contract for per-chunk checkpoints without
// requiring a live database connection. The runtime integration is covered by
// Prisma/typecheck/build.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf-8");

describe("AiAnalyzeChunk Prisma model", () => {
  it("defines a durable per-chunk checkpoint table with required indexes", () => {
    const schema = read("prisma/schema.prisma");
    assert.match(schema, /model\s+AiAnalyzeChunk\s+{/);
    for (const field of [
      "tenderId     String",
      "userId       String",
      "contentHash  String",
      "chunkIndex   Int",
      "totalChunks  Int",
      'status       String   @default("QUEUED")',
      "provider     String?",
      "resultJson   String?",
      "errorMessage String?",
      "startedAt    DateTime?",
      "finishedAt   DateTime?",
    ]) {
      assert.ok(schema.includes(field), `missing field: ${field}`);
    }
    assert.ok(schema.includes("@@unique([tenderId, userId, contentHash, chunkIndex])"));
    assert.ok(schema.includes("@@index([tenderId, userId, contentHash])"));
    assert.ok(schema.includes("@@index([status])"));
  });

  it("ships a migration for the checkpoint table", () => {
    const migrationPath = "prisma/migrations/20260611000000_add_ai_analyze_chunks/migration.sql";
    assert.ok(existsSync(path.join(root, migrationPath)), "migration file should exist");
    const migration = read(migrationPath);
    assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "AiAnalyzeChunk"'));
    assert.ok(migration.includes('"AiAnalyzeChunk_tenderId_userId_contentHash_chunkIndex_key"'));
    assert.ok(migration.includes('"AiAnalyzeChunk_tenderId_userId_contentHash_idx"'));
    assert.ok(migration.includes('"AiAnalyzeChunk_status_idx"'));
  });
});

describe("lib/ai-analyze-checkpoints helper", () => {
  it("exports the required checkpoint operations", () => {
    const helper = read("lib/ai-analyze-checkpoints.ts");
    for (const fnName of [
      "getAnalyzeCheckpoints",
      "upsertAnalyzeChunkStarted",
      "upsertAnalyzeChunkSucceeded",
      "upsertAnalyzeChunkFailed",
      "getCompletedChunkResults",
      "getAnalyzeProgress",
      "clearAnalyzeCheckpoints",
      "clearAnalyzeCheckpointsForContentHashMismatch",
    ]) {
      assert.match(helper, new RegExp(`export async function ${fnName}\\b`));
    }
  });

  it("uses upserts so every chunk row is durable and idempotent", () => {
    const helper = read("lib/ai-analyze-checkpoints.ts");
    const upsertCount = (helper.match(/prisma\.aiAnalyzeChunk\.upsert/g) ?? []).length;
    assert.equal(upsertCount, 3, "started/succeeded/failed helpers should all upsert");
    assert.ok(helper.includes('status: "RUNNING"'));
    assert.ok(helper.includes('status: "SUCCEEDED"'));
    assert.ok(helper.includes('status: "FAILED"'));
  });

  it("returns only successful chunk rows as previousChunkResults", () => {
    const helper = read("lib/ai-analyze-checkpoints.ts");
    assert.ok(helper.includes('status: "SUCCEEDED"'));
    assert.ok(helper.includes("parseChunkResult"));
    assert.ok(helper.includes("resultJson"));
  });

  it("calculates progressPercent and resumeAvailable from checkpoint rows", () => {
    const helper = read("lib/ai-analyze-checkpoints.ts");
    assert.ok(helper.includes("progressPercent"));
    assert.ok(helper.includes("completedChunks"));
    assert.ok(helper.includes("failedChunks"));
    assert.ok(helper.includes("resumeAvailable"));
    assert.ok(helper.includes("Math.round((completedChunks / totalChunks) * 100)"));
  });

  it("does not reuse checkpoints when the content hash changes", () => {
    const helper = read("lib/ai-analyze-checkpoints.ts");
    assert.ok(helper.includes("contentHash: { not: contentHash }"));
  });
});

describe("analyzeWithAI checkpoint callbacks", () => {
  it("supports chunk start, success, and failure callbacks", () => {
    const ai = read("lib/ai.ts");
    assert.ok(ai.includes("onChunkStart?:"));
    assert.ok(ai.includes("onChunkComplete?:"));
    assert.ok(ai.includes("onChunkFailure?:"));
    assert.ok(ai.includes("opts?.onChunkStart?."));
    assert.ok(ai.includes("opts?.onChunkFailure?."));
  });

  it("continues to skip completed chunks and retry missing failed chunks", () => {
    const ai = read("lib/ai.ts");
    assert.ok(ai.includes("const previousIndexes = new Set(previousChunkResults.map((entry) => entry.index));"));
    assert.ok(ai.includes("const hasSavedChunkResults = previousChunkResults.length > 0;"));
    assert.ok(ai.includes("const startIndex = hasSavedChunkResults ? 0 : Math.max(opts?.startFromChunk ?? 0, 0);"));
    assert.ok(ai.includes("!previousIndexes.has(c.index) && c.index >= startIndex"));
  });
});

describe("AI Analyze route checkpoint integration", () => {
  it("loads successful durable checkpoints as the primary resume source", () => {
    const route = read("app/api/tenders/[id]/ai-analyze/route.ts");
    assert.ok(route.includes("getCompletedChunkResults(tenderId, userId, contentHash)"));
    assert.ok(route.includes("const durableChunks = await getCompletedChunkResults(id, userId, contentHash);"));
    assert.ok(route.includes("await clearAnalyzeCheckpoints(id, userId, contentHash);"));
    assert.ok(route.includes("previousChunkResults = durableChunks;"));
    assert.ok(route.includes("startFromChunk = 0;"));
  });

  it("persists started, succeeded, and failed chunk checkpoints from both analyze paths", () => {
    const route = read("app/api/tenders/[id]/ai-analyze/route.ts");
    assert.ok(route.includes("upsertAnalyzeChunkStarted"));
    assert.ok(route.includes("upsertAnalyzeChunkSucceeded"));
    assert.ok(route.includes("upsertAnalyzeChunkFailed"));
    // Phase 1: Non-streaming path uses orchestrator wrapper which sets up callbacks
    assert.ok(route.includes("executeAnalysisViaOrchestrator"));
    assert.ok(route.includes("onChunkStart:") && route.includes("upsertAnalyzeChunkStarted"));
  });

  it("keeps AiJob.output progress for UI compatibility", () => {
    const route = read("app/api/tenders/[id]/ai-analyze/route.ts");
    // Phase 1: Orchestrator stores output with result and chunkResults for UI progress
    assert.ok(route.includes("executeAnalysisViaOrchestrator"));
    // Orchestrator preserves progress in job output on error or partial completion
    const orchestrator = read("lib/engine/analysis-orchestrator.ts");
    assert.ok(orchestrator.includes("chunkResults: analysisMeta.chunkResults"));
  });
});

describe("tender GET route checkpoint progress", () => {
  it("returns aiAnalyzeCheckpointProgress alongside latestPartialAnalysisJob", () => {
    const route = read("app/api/tenders/[id]/route.ts");
    assert.ok(route.includes("getLatestAnalyzeCheckpointProgress"));
    assert.ok(route.includes("aiAnalyzeCheckpointProgress"));
    assert.ok(route.includes("latestPartialAnalysisJob: partialJobInfo"));
  });
});
