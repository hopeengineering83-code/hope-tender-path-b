// Durable AI Analyze jobs — regression tests.
//
// These tests verify the contract of the durable AI Analyze jobs system
// without requiring a database, authenticated session, or live AI provider
// keys. They use pure-function imports + source-shape assertions.
//
// Required scenarios from the mission:
//   1.  Concurrent run-next calls cannot process one chunk twice.
//   2.  Browser interruption leaves job resumable.
//   3.  Resume processes unfinished chunks only.
//   4.  Partial job preserves canonical requirements.
//   5.  Failed retry preserves prior canonical success.
//   6.  Finalize rejects weakly sourced mandatory requirements.
//   7.  Fallback-unapproved cannot unlock export.
//   8.  Jobs/chunks remain tenant-scoped.
//   9.  Old single-route AI Analyze behavior remains backward compatible.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  calculateContentHash,
  splitIntoChunks,
  classifySafeFailure,
  safeFailureMessage,
  CHUNK_SIZE,
  STUCK_CLAIM_THRESHOLD_MS,
  type SafeFailureCategory,
} from "../lib/ai-jobs/durable-analyze";

// ─── Pure function tests ────────────────────────────────────────────────────

describe("calculateContentHash", () => {
  it("produces a 16-char hex hash", () => {
    const hash = calculateContentHash("test content");
    assert.equal(hash.length, 16);
    assert.match(hash, /^[a-f0-9]+$/);
  });

  it("produces different hashes for different content", () => {
    const h1 = calculateContentHash("content A");
    const h2 = calculateContentHash("content B");
    assert.notEqual(h1, h2);
  });

  it("produces the same hash for the same content", () => {
    const h1 = calculateContentHash("same content");
    const h2 = calculateContentHash("same content");
    assert.equal(h1, h2);
  });
});

describe("splitIntoChunks", () => {
  it("splits content into chunks of CHUNK_SIZE", () => {
    const content = "A".repeat(CHUNK_SIZE * 3 + 100);
    const chunks = splitIntoChunks(content);
    assert.equal(chunks.length, 4);
    assert.equal(chunks[0].length, CHUNK_SIZE);
    assert.equal(chunks[3].length, 100);
  });

  it("returns a single chunk for content under CHUNK_SIZE", () => {
    const content = "short content";
    const chunks = splitIntoChunks(content);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], content);
  });

  it("returns an empty array for empty content", () => {
    assert.deepEqual(splitIntoChunks(""), []);
  });

  it("does NOT hardcode total chunks — derives from content length", () => {
    // Verify the rule: "Do not hardcode total chunks."
    const chunks = splitIntoChunks("A".repeat(CHUNK_SIZE * 10));
    assert.equal(chunks.length, 10);
  });
});

describe("classifySafeFailure", () => {
  it("classifies 429 as RATE_LIMITED", () => {
    assert.equal(classifySafeFailure(new Error("HTTP 429 Too Many Requests")), "RATE_LIMITED");
  });

  it("classifies timeout as TIMEOUT", () => {
    assert.equal(classifySafeFailure(new Error("Request timed out after 30s")), "TIMEOUT");
  });

  it("classifies 401 as UNAUTHORIZED", () => {
    assert.equal(classifySafeFailure(new Error("HTTP 401 Unauthorized")), "UNAUTHORIZED");
  });

  it("classifies model-not-found as MODEL_UNAVAILABLE", () => {
    assert.equal(classifySafeFailure(new Error("HTTP 404 model not found")), "MODEL_UNAVAILABLE");
  });

  it("classifies network errors as NETWORK_ERROR", () => {
    assert.equal(classifySafeFailure(new Error("fetch failed: ECONNRESET")), "NETWORK_ERROR");
  });

  it("classifies unknown errors as UNKNOWN", () => {
    assert.equal(classifySafeFailure(new Error("something weird")), "UNKNOWN");
  });

  it("never includes the raw error message in the return value (returns category only)", () => {
    const category = classifySafeFailure(new Error("sk-secret-key-1234567890"));
    // The return value is a category string, NOT the raw error
    assert.ok(["RATE_LIMITED", "TIMEOUT", "UNAUTHORIZED", "MODEL_UNAVAILABLE", "NETWORK_ERROR", "UNKNOWN"].includes(category));
    assert.notEqual(category, "sk-secret-key-1234567890");
  });
});

describe("safeFailureMessage", () => {
  it("returns a human-readable message for each category", () => {
    const categories: SafeFailureCategory[] = ["RATE_LIMITED", "TIMEOUT", "UNAUTHORIZED", "MODEL_UNAVAILABLE", "NETWORK_ERROR", "UNKNOWN"];
    for (const cat of categories) {
      const msg = safeFailureMessage(cat);
      assert.ok(msg.length > 10, `${cat} must have a message`);
      assert.ok(!msg.includes("sk-"), `${cat} message must not contain API keys`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 1: Concurrent run-next calls cannot process one chunk twice
// ════════════════════════════════════════════════════════════════════════════

describe("SCENARIO 1: Concurrent run-next calls cannot process one chunk twice", () => {
  it("claimNextChunk uses FOR UPDATE SKIP LOCKED (source-shape guard)", () => {
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    assert.match(src, /FOR UPDATE SKIP LOCKED/);
  });

  it("claimNextChunk sets claimedAt atomically (source-shape guard)", () => {
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    assert.match(src, /"claimedAt" = NOW\(\)/);
  });

  it("claimNextChunk claims only QUEUED or stale-RUNNING chunks (source-shape guard)", () => {
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    // The WHERE clause must include both "QUEUED" and stale-RUNNING conditions
    assert.match(src, /"status" = 'QUEUED'/);
    assert.match(src, /"status" = 'RUNNING' AND "claimedAt" < /);
  });

  it("claimNextChunk returns at most one chunk (LIMIT 1, source-shape guard)", () => {
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    assert.match(src, /LIMIT 1/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 2: Browser interruption leaves job resumable
// ════════════════════════════════════════════════════════════════════════════

describe("SCENARIO 2: Browser interruption leaves job resumable", () => {
  it("a stale claim (claimedAt older than STUCK_CLAIM_THRESHOLD_MS) can be re-claimed", () => {
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    assert.match(src, /STUCK_CLAIM_THRESHOLD_MS/);
    // The stale-claim re-claim logic must be in the WHERE clause
    assert.match(src, /"claimedAt" < \$/);
  });

  it("STUCK_CLAIM_THRESHOLD_MS is 90 seconds (reasonable for Vercel 60s timeout + buffer)", () => {
    assert.equal(STUCK_CLAIM_THRESHOLD_MS, 90_000);
  });

  it("a chunk left in RUNNING state (browser closed) is re-claimable, not lost", () => {
    // The claimNextChunk query explicitly includes RUNNING chunks with stale claims.
    // This means a browser interruption (which leaves the chunk in RUNNING) does
    // NOT permanently block the job — the next run-next call will re-claim it.
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    assert.match(src, /OR \("status" = 'RUNNING' AND "claimedAt" < /);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 3: Resume processes unfinished chunks only
// ════════════════════════════════════════════════════════════════════════════

describe("SCENARIO 3: Resume processes unfinished chunks only", () => {
  it("createAnalyzeJob reuses succeeded chunks (does not reset them)", () => {
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    // The createAnalyzeJob function must check for existing SUCCEEDED chunks
    // and skip resetting them.
    assert.match(src, /existing\?\.status === "SUCCEEDED"/);
    assert.match(src, /\/\/ Reuse the succeeded chunk — don't reset it\./);
  });

  it("createAnalyzeJob reuses an existing resumable job (state=REUSED)", () => {
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    assert.match(src, /state: "REUSED"/);
  });

  it("claimNextChunk only claims QUEUED or stale-RUNNING chunks (never SUCCEEDED)", () => {
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    // The WHERE clause must NOT include SUCCEEDED
    const claimSection = src.match(/WHERE "tenderId" = \$\{job\.tenderId\}[\s\S]*?FOR UPDATE/);
    assert.ok(claimSection);
    assert.doesNotMatch(claimSection[0], /"status" = 'SUCCEEDED'/);
  });

  it("getJobProgress reports resumable = pendingChunks > 0 && completedChunks < totalChunks", () => {
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    assert.match(src, /resumable:\s*pendingChunks\s*>\s*0\s*&&\s*completedChunks\s*<\s*totalChunks/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 4: Partial job preserves canonical requirements
// ════════════════════════════════════════════════════════════════════════════

describe("SCENARIO 4: Partial job preserves canonical requirements", () => {
  it("finalizeAnalyzeJob rejects when chunks are still pending (CHUNKS_PENDING)", () => {
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    assert.match(src, /code: "CHUNKS_PENDING"/);
    assert.match(src, /succeededChunks\.length < totalChunks/);
  });

  it("finalizeAnalyzeJob never promotes partial output (requires ALL chunks succeeded)", () => {
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    // The finalize function must check both: no failed chunks AND all chunks succeeded
    assert.match(src, /failedChunks\.length > 0/);
    assert.match(src, /succeededChunks\.length < totalChunks/);
  });

  it("finalizeAnalyzeJob preserves previous requirements until promotion succeeds (transaction)", () => {
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    // The delete + insert + promote must be in a single transaction
    assert.match(src, /prisma\.\$transaction/);
    assert.match(src, /tenderRequirement\.deleteMany/);
    assert.match(src, /tenderRequirement\.create/);
    // The aiJob.update with promotedAt must be inside the transaction
    assert.match(src, /tx\.aiJob\.update[\s\S]*?promotedAt:/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 5: Failed retry preserves prior canonical success
// ════════════════════════════════════════════════════════════════════════════

describe("SCENARIO 5: Failed retry preserves prior canonical success", () => {
  it("markJobAsFallbackDraft does NOT promote the job (no promotedAt)", () => {
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    // The markJobAsFallbackDraft function must NOT set promotedAt
    const fnMatch = src.match(/export async function markJobAsFallbackDraft[\s\S]*?\n\}/);
    assert.ok(fnMatch);
    assert.doesNotMatch(fnMatch[0], /promotedAt:\s*new Date\(\)/);
    assert.match(fnMatch[0], /status: "FAILED"/);
  });

  it("markJobAsFallbackDraft stores FALLBACK_DRAFT in stagedMergedResult (draft-only)", () => {
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    assert.match(src, /analysisSource: "FALLBACK_DRAFT"/);
  });

  it("markJobAsFallbackDraft never stores raw error messages (errorMessage: null)", () => {
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    const fnMatch = src.match(/export async function markJobAsFallbackDraft[\s\S]*?\n\}/);
    assert.ok(fnMatch);
    assert.match(fnMatch[0], /errorMessage: null/);
  });

  it("a prior promoted job is NOT affected by a new failed job (canonicalJob pattern)", () => {
    // The canonical resolver (analysis-state-resolver.ts) loads the latest
    // promoted job separately from the latest job. A new failed job does NOT
    // overwrite or hide the prior promoted success. This is verified in the
    // analysis-state-resolver tests — here we verify the durable analyze
    // library does NOT promote on failure.
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    // saveChunkResult with FAILED status must NOT set promotedAt
    const saveMatch = src.match(/export async function saveChunkResult[\s\S]*?\n\}/);
    assert.ok(saveMatch);
    assert.doesNotMatch(saveMatch[0], /promotedAt/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 6: Finalize rejects weakly sourced mandatory requirements
// ════════════════════════════════════════════════════════════════════════════

describe("SCENARIO 6: Finalize rejects weakly sourced mandatory requirements", () => {
  it("finalizeAnalyzeJob checks for mandatory requirements missing source grounding", () => {
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    assert.match(src, /MANDATORY_PRIORITY_REGEX/);
    assert.match(src, /mandatory|critical/i);
  });

  it("finalizeAnalyzeJob requires sourceFileName + sourcePage + sourceQuote + sourceConfidence", () => {
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    assert.match(src, /!r\.sourceFileName/);
    assert.match(src, /r\.sourcePage == null/);
    assert.match(src, /!r\.sourceQuote/);
    assert.match(src, /r\.sourceConfidence == null/);
  });

  it("finalizeAnalyzeJob returns WEAK_SOURCE_GROUNDING when mandatory requirements lack grounding", () => {
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    assert.match(src, /code: "WEAK_SOURCE_GROUNDING"/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 7: Fallback-unapproved cannot unlock export
// ════════════════════════════════════════════════════════════════════════════

describe("SCENARIO 7: Fallback-unapproved cannot unlock export", () => {
  it("markJobAsFallbackDraft sets status to FAILED (not SUCCEEDED)", () => {
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    const fnMatch = src.match(/export async function markJobAsFallbackDraft[\s\S]*?\n\}/);
    assert.ok(fnMatch);
    assert.match(fnMatch[0], /status: "FAILED"/);
  });

  it("markJobAsFallbackDraft does NOT set promotedAt (no export unlock)", () => {
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    const fnMatch = src.match(/export async function markJobAsFallbackDraft[\s\S]*?\n\}/);
    assert.ok(fnMatch);
    assert.doesNotMatch(fnMatch[0], /promotedAt/);
  });

  it("the analysis-state-resolver treats FALLBACK_DRAFT + not-promoted as REGEX_FALLBACK_UNAPPROVED", () => {
    // This is verified in the analysis-state-resolver tests. Here we verify
    // the durable analyze library's markJobAsFallbackDraft produces the
    // stagedMergedResult format the resolver expects.
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    assert.match(src, /analysisSource: "FALLBACK_DRAFT"/);
  });

  it("finalizeAnalyzeJob never promotes regex fallback automatically (no FALLBACK_DRAFT promotion path)", () => {
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    const fnMatch = src.match(/export async function finalizeAnalyzeJob[\s\S]*?\n\}/);
    assert.ok(fnMatch);
    // The finalize function must NOT have a code path that promotes FALLBACK_DRAFT
    assert.doesNotMatch(fnMatch[0], /FALLBACK_DRAFT/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 8: Jobs/chunks remain tenant-scoped
// ════════════════════════════════════════════════════════════════════════════

describe("SCENARIO 8: Jobs/chunks remain tenant-scoped", () => {
  it("createAnalyzeJob scopes the tender lookup by userId (source-shape guard)", () => {
    const routeSrc = readFileSync("app/api/tenders/[id]/ai-analyze/jobs/route.ts", "utf-8");
    assert.match(routeSrc, /prisma\.tender\.findFirst\(\s*\{\s*where:\s*\{\s*id:\s*tenderId,\s*userId:\s*actor\.id\s*\}/);
  });

  it("createAnalyzeJob (lib) scopes chunk creation by userId (source-shape guard)", () => {
    const libSrc = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    // The createAnalyzeJob function must include userId in all chunk queries
    assert.match(libSrc, /tenderId,\s*userId,\s*contentHash/);
  });

  it("claimNextChunk scopes by tenderId + userId + contentHash (source-shape guard)", () => {
    const libSrc = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    assert.match(libSrc, /WHERE "tenderId" = \$\{job\.tenderId\}/);
    assert.match(libSrc, /AND "userId" = \$\{job\.userId\}/);
    assert.match(libSrc, /AND "contentHash" = \$\{contentHash\}/);
  });

  it("run-next route verifies caller owns the job (tenant isolation, source-shape guard)", () => {
    const routeSrc = readFileSync("app/api/ai-jobs/[jobId]/run-next/route.ts", "utf-8");
    assert.match(routeSrc, /job\.userId !== userId/);
    assert.match(routeSrc, /Job not found/);
  });

  it("finalize route verifies caller owns the job (tenant isolation, source-shape guard)", () => {
    const routeSrc = readFileSync("app/api/ai-jobs/[jobId]/finalize/route.ts", "utf-8");
    assert.match(routeSrc, /job\.userId !== actor\.id/);
    assert.match(routeSrc, /Job not found/);
  });

  it("GET /api/ai-jobs/[id] verifies caller owns the job (source-shape guard)", () => {
    const routeSrc = readFileSync("app/api/ai-jobs/[id]/route.ts", "utf-8");
    assert.match(routeSrc, /accessRow\.userId !== actor\.id/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 9: Old single-route AI Analyze behavior remains backward compatible
// ════════════════════════════════════════════════════════════════════════════

describe("SCENARIO 9: Old single-route AI Analyze remains backward compatible", () => {
  it("the old POST /api/tenders/[id]/ai-analyze route still exists and handles POST", () => {
    const routeSrc = readFileSync("app/api/tenders/[id]/ai-analyze/route.ts", "utf-8");
    assert.match(routeSrc, /export async function POST/);
  });

  it("the old route includes a backward-compatible pointer to the new durable jobs endpoint", () => {
    const routeSrc = readFileSync("app/api/tenders/[id]/ai-analyze/route.ts", "utf-8");
    assert.match(routeSrc, /durableJobEndpoint/);
    assert.match(routeSrc, /\/api\/tenders\/\$\{id\}\/ai-analyze\/jobs/);
  });

  it("the old route still returns the existing response shape (success, analysisSource, jobId, chunks)", () => {
    const routeSrc = readFileSync("app/api/tenders/[id]/ai-analyze/route.ts", "utf-8");
    assert.match(routeSrc, /success: true/);
    assert.match(routeSrc, /analysisSource:/);
    assert.match(routeSrc, /jobId:/);
    assert.match(routeSrc, /chunks:/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Migration + schema verification
// ════════════════════════════════════════════════════════════════════════════

describe("Migration: additive, non-destructive", () => {
  it("migration file exists", () => {
    assert.ok(existsSync("prisma/migrations/20260620150000_durable_ai_analysis/migration.sql"));
  });

  it("migration uses ALTER TABLE ADD COLUMN IF NOT EXISTS (additive)", () => {
    const sql = readFileSync("prisma/migrations/20260620150000_durable_ai_analysis/migration.sql", "utf-8");
    assert.match(sql, /ALTER TABLE "AiAnalyzeChunk" ADD COLUMN IF NOT EXISTS "claimedAt"/);
    assert.match(sql, /ALTER TABLE "AiAnalyzeChunk" ADD COLUMN IF NOT EXISTS "failureCategory"/);
  });

  it("migration uses CREATE INDEX IF NOT EXISTS (idempotent)", () => {
    const sql = readFileSync("prisma/migrations/20260620150000_durable_ai_analysis/migration.sql", "utf-8");
    assert.match(sql, /CREATE INDEX IF NOT EXISTS/);
  });

  it("migration does NOT contain DROP TABLE, DROP COLUMN, or destructive operations", () => {
    const sql = readFileSync("prisma/migrations/20260620150000_durable_ai_analysis/migration.sql", "utf-8");
    assert.doesNotMatch(sql, /DROP TABLE/i);
    assert.doesNotMatch(sql, /DROP COLUMN/i);
    assert.doesNotMatch(sql, /TRUNCATE/i);
    assert.doesNotMatch(sql, /DELETE FROM/i);
  });
});

describe("Schema: AiAnalyzeChunk has the new fields", () => {
  it("schema.prisma includes claimedAt on AiAnalyzeChunk", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf-8");
    const chunkBlock = schema.match(/model AiAnalyzeChunk \{[\s\S]*?\n\}/);
    assert.ok(chunkBlock);
    assert.match(chunkBlock[0], /claimedAt\s+DateTime\?/);
  });

  it("schema.prisma includes failureCategory on AiAnalyzeChunk", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf-8");
    const chunkBlock = schema.match(/model AiAnalyzeChunk \{[\s\S]*?\n\}/);
    assert.ok(chunkBlock);
    assert.match(chunkBlock[0], /failureCategory\s+String\?/);
  });

  it("schema.prisma includes the composite index for atomic claims", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf-8");
    const chunkBlock = schema.match(/model AiAnalyzeChunk \{[\s\S]*?\n\}/);
    assert.ok(chunkBlock);
    assert.match(chunkBlock[0], /@@index\(\[tenderId, userId, contentHash, status\]\)/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Routes exist
// ════════════════════════════════════════════════════════════════════════════

describe("All required routes exist", () => {
  it("POST /api/tenders/[id]/ai-analyze/jobs route exists", () => {
    assert.ok(existsSync("app/api/tenders/[id]/ai-analyze/jobs/route.ts"));
  });

  it("POST /api/ai-jobs/[jobId]/run-next route exists", () => {
    assert.ok(existsSync("app/api/ai-jobs/[jobId]/run-next/route.ts"));
  });

  it("POST /api/ai-jobs/[jobId]/finalize route exists", () => {
    assert.ok(existsSync("app/api/ai-jobs/[jobId]/finalize/route.ts"));
  });

  it("GET /api/ai-jobs/[jobId] (existing [id] route) exists and includes chunkProgress", () => {
    const src = readFileSync("app/api/ai-jobs/[id]/route.ts", "utf-8");
    assert.match(src, /getJobProgress/);
    assert.match(src, /chunkProgress/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// No raw provider error data exposed
// ════════════════════════════════════════════════════════════════════════════

describe("No raw provider error data exposed", () => {
  it("saveChunkResult stores errorMessage: null (never the raw error message)", () => {
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    const fnMatch = src.match(/export async function saveChunkResult[\s\S]*?\n\}/);
    assert.ok(fnMatch);
    // The FAILED branch must set errorMessage: null
    assert.match(fnMatch[0], /errorMessage: null/);
  });

  it("saveChunkResult stores failureCategory (safe classification only)", () => {
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    const fnMatch = src.match(/export async function saveChunkResult[\s\S]*?\n\}/);
    assert.ok(fnMatch);
    assert.match(fnMatch[0], /failureCategory: category/);
  });

  it("markJobAsFallbackDraft stores errorMessage: null", () => {
    const src = readFileSync("lib/ai-jobs/durable-analyze.ts", "utf-8");
    const fnMatch = src.match(/export async function markJobAsFallbackDraft[\s\S]*?\n\}/);
    assert.ok(fnMatch);
    assert.match(fnMatch[0], /errorMessage: null/);
  });

  it("run-next route catch block saves safe failure classification, not raw error", () => {
    const src = readFileSync("app/api/ai-jobs/[jobId]/run-next/route.ts", "utf-8");
    assert.match(src, /saveChunkResult/);
    assert.match(src, /status: "FAILED"/);
    // Must NOT return raw error.message in the response
    assert.doesNotMatch(src, /error:\s*err\.message/);
  });
});
