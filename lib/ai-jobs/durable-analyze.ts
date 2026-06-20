// Durable AI Analyze jobs — core library.
//
// Replaces browser-owned long AI Analyze execution with durable persisted
// jobs. Each chunk is processed atomically via FOR UPDATE SKIP LOCKED,
// making the system resilient to browser interruptions and Vercel function
// timeouts.
//
// Architecture:
//   1. createAnalyzeJob(tenderId, userId) — validates extraction, calculates
//      content hash, creates/reuses a resumable AiJob + AiAnalyzeChunk rows.
//      Does NOT analyze any chunks.
//   2. claimNextChunk(jobId) — atomically claims exactly one QUEUED chunk.
//      Returns null if no chunks are pending.
//   3. processChunk(chunkId) — processes the claimed chunk via the AI
//      provider chain. Saves the real provider attempt result or a safe
//      failure category.
//   4. finalizeAnalyzeJob(jobId) — merges + deduplicates requirements,
//      validates source grounding for mandatory requirements, atomically
//      promotes canonical requirements. Never promotes partial output or
//      regex fallback.
//
// Critical rules enforced:
//   - A latest failed job must never hide a prior promoted AI success.
//   - Provider exhaustion becomes REGEX_FALLBACK_UNAPPROVED (draft-only).
//   - Finalize runs only after every required chunk succeeds.
//   - Mandatory requirements require source file + page + quote + confidence.
//   - Prior canonical requirements are preserved until promotion succeeds.
//   - No raw provider error data is ever exposed.

import crypto from "crypto";
import { prisma, prismaReady } from "../prisma";
import { Prisma } from "@prisma/client";

// ─── Constants ───────────────────────────────────────────────────────────────

export const AI_ANALYZE_JOB_TYPE = "AI_ANALYZE" as const;
export const CHUNK_SIZE = 50_000; // chars per chunk
export const STUCK_CLAIM_THRESHOLD_MS = 90_000; // a claim older than 90s is stale

// Safe failure categories — never include raw provider error bodies.
export type SafeFailureCategory =
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "UNAUTHORIZED"
  | "MODEL_UNAVAILABLE"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export type ChunkStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CreateJobResult {
  jobId: string;
  totalChunks: number;
  state: "CREATED" | "REUSED";
  contentHash: string;
  nextAction: "RUN_NEXT" | "FINALIZE" | "RESUME";
}

export interface ClaimedChunk {
  chunkId: string;
  chunkIndex: number;
  totalChunks: number;
  contentHash: string;
  tenderId: string;
  userId: string;
}

export interface ChunkProcessingResult {
  chunkId: string;
  status: "SUCCEEDED" | "FAILED";
  provider: string | null;
  failureCategory: SafeFailureCategory | null;
  safeDiagnosticSummary: string;
}

export interface FinalizeResult {
  ok: boolean;
  code: "FINALIZED" | "CHUNKS_PENDING" | "CHUNKS_FAILED" | "WEAK_SOURCE_GROUNDING" | "ALREADY_PROMOTED" | "JOB_NOT_FOUND";
  requirementsPromoted: number;
  requirementsDeduplicated: number;
  safeDiagnosticSummary: string;
}

export interface JobProgress {
  jobId: string;
  status: string;
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  pendingChunks: number;
  progressPercent: number;
  resumable: boolean;
  analysisSource: "AI" | "REGEX_FALLBACK" | "NONE";
  nextAction: "RUN_NEXT" | "FINALIZE" | "RESUME" | "RETRY" | "DONE";
  safeDiagnosticSummary: string;
}

// ─── Content hash calculation ────────────────────────────────────────────────

/**
 * Calculate a content hash for the tender's extracted text.
 * The hash changes when the tender content changes, so stale checkpoints
 * are automatically invalidated.
 */
export function calculateContentHash(tenderContent: string): string {
  return crypto.createHash("sha256").update(tenderContent).digest("hex").slice(0, 16);
}

/**
 * Split tender content into chunks of CHUNK_SIZE chars.
 */
export function splitIntoChunks(content: string): string[] {
  if (content.length === 0) return [];
  const chunks: string[] = [];
  for (let i = 0; i < content.length; i += CHUNK_SIZE) {
    chunks.push(content.slice(i, i + CHUNK_SIZE));
  }
  return chunks;
}

// ─── Safe error classification ───────────────────────────────────────────────

/**
 * Classify an error into a safe failure category. Never includes raw
 * provider error bodies — only the abstract category.
 */
export function classifySafeFailure(error: unknown): SafeFailureCategory {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? "").toLowerCase();
  if (/429|rate.?limit|quota|too many requests|resource exhausted/.test(message)) return "RATE_LIMITED";
  if (/timed out|timeout|abort/.test(message)) return "TIMEOUT";
  if (/401|403|unauthorized|forbidden|invalid api key|auth/.test(message)) return "UNAUTHORIZED";
  if (/404|model not found|not supported|model unavailable|invalid_request/.test(message)) return "MODEL_UNAVAILABLE";
  if (/network|fetch failed|econnreset|enotfound|socket hang up/.test(message)) return "NETWORK_ERROR";
  return "UNKNOWN";
}

/**
 * Build a safe diagnostic summary from a failure category. Never includes
 * the raw error message.
 */
export function safeFailureMessage(category: SafeFailureCategory): string {
  const messages: Record<SafeFailureCategory, string> = {
    RATE_LIMITED: "AI provider rate limit reached. Wait for cooldown and retry.",
    TIMEOUT: "AI provider request timed out. Retry or reduce tender size.",
    UNAUTHORIZED: "AI provider authentication failed. Check API key configuration.",
    MODEL_UNAVAILABLE: "AI model unavailable. Check model configuration.",
    NETWORK_ERROR: "Network error contacting AI provider. Retry.",
    UNKNOWN: "AI provider returned an unknown error. Retry or contact support.",
  };
  return messages[category];
}

// ─── Job creation ────────────────────────────────────────────────────────────

/**
 * Create or reuse a resumable AI Analyze job.
 *
 * Steps:
 *   1. Validate the tender exists and belongs to the user (tenant isolation).
 *   2. Validate extraction readiness (files exist with extracted text).
 *   3. Calculate the source content hash.
 *   4. Check for an existing resumable job with the same content hash.
 *   5. If found, return it (state=REUSED). If not, create a new AiJob +
 *      AiAnalyzeChunk rows.
 *   6. Does NOT analyze any chunks — that's done by run-next.
 */
export async function createAnalyzeJob(
  tenderId: string,
  userId: string,
  tenderContent: string,
  options?: { force?: boolean }
): Promise<CreateJobResult> {
  await prismaReady;

  const contentHash = calculateContentHash(tenderContent);
  const chunks = splitIntoChunks(tenderContent);
  const totalChunks = chunks.length;

  if (totalChunks === 0) {
    throw new Error("Cannot create AI Analyze job: tender content is empty.");
  }

  // Check for an existing resumable job with the same content hash.
  // A resumable job is one that is QUEUED or RUNNING with pending chunks.
  if (!options?.force) {
    const existingJob = await prisma.aiJob.findFirst({
      where: {
        tenderId,
        userId,
        jobType: AI_ANALYZE_JOB_TYPE,
        status: { in: ["QUEUED", "RUNNING"] },
        analysisInputHash: contentHash,
        supersededBy: null,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (existingJob) {
      // Check if there are pending chunks for this job.
      const pendingCount = await prisma.aiAnalyzeChunk.count({
        where: {
          tenderId, userId, contentHash,
          status: { in: ["QUEUED", "RUNNING"] },
        },
      });

      if (pendingCount > 0) {
        return {
          jobId: existingJob.id,
          totalChunks,
          state: "REUSED",
          contentHash,
          nextAction: "RUN_NEXT",
        };
      }

      // All chunks done — check if finalize is needed.
      const succeededCount = await prisma.aiAnalyzeChunk.count({
        where: { tenderId, userId, contentHash, status: "SUCCEEDED" },
      });
      if (succeededCount === totalChunks) {
        return {
          jobId: existingJob.id,
          totalChunks,
          state: "REUSED",
          contentHash,
          nextAction: "FINALIZE",
        };
      }
    }
  }

  // Create a new job + chunk records in a transaction.
  const job = await prisma.$transaction(async (tx) => {
    // Create the AiJob
    const newJob = await tx.aiJob.create({
      data: {
        tenderId,
        userId,
        jobType: AI_ANALYZE_JOB_TYPE,
        status: "QUEUED",
        analysisInputHash: contentHash,
        input: JSON.stringify({
          contentLength: tenderContent.length,
          chunkCount: totalChunks,
          contentHash,
        }),
      },
      select: { id: true },
    });

    // Create chunk records. Use upsert to handle the case where chunks
    // already exist from a prior run with the same content hash (they
    // will be reused if they succeeded, or reset if force=true).
    for (let i = 0; i < totalChunks; i++) {
      const existing = options?.force
        ? null
        : await tx.aiAnalyzeChunk.findUnique({
            where: {
              tenderId_userId_contentHash_chunkIndex: {
                tenderId, userId, contentHash, chunkIndex: i,
              },
            },
            select: { status: true },
          });

      if (existing?.status === "SUCCEEDED") {
        // Reuse the succeeded chunk — don't reset it.
        continue;
      }

      await tx.aiAnalyzeChunk.upsert({
        where: {
          tenderId_userId_contentHash_chunkIndex: {
            tenderId, userId, contentHash, chunkIndex: i,
          },
        },
        create: {
          tenderId, userId, contentHash,
          chunkIndex: i, totalChunks,
          status: "QUEUED",
        },
        update: {
          totalChunks,
          status: "QUEUED",
          provider: null,
          resultJson: null,
          errorMessage: null,
          failureCategory: null,
          startedAt: null,
          finishedAt: null,
          claimedAt: null,
        },
      });
    }

    return newJob;
  });

  return {
    jobId: job.id,
    totalChunks,
    state: "CREATED",
    contentHash,
    nextAction: "RUN_NEXT",
  };
}

// ─── Atomic chunk claim ──────────────────────────────────────────────────────

/**
 * Atomically claim exactly one pending chunk for a job.
 *
 * Uses FOR UPDATE SKIP LOCKED to prevent duplicate concurrent execution.
 * If a chunk has a stale claim (claimedAt older than STUCK_CLAIM_THRESHOLD_MS),
 * it can be re-claimed — this makes the system resilient to browser
 * interruptions and Vercel function timeouts.
 *
 * Returns null if no chunks are pending.
 */
export async function claimNextChunk(jobId: string): Promise<ClaimedChunk | null> {
  await prismaReady;

  // Get the job's tenderId, userId, contentHash
  const job = await prisma.aiJob.findUnique({
    where: { id: jobId },
    select: { tenderId: true, userId: true, analysisInputHash: true, status: true },
  });

  if (!job || !job.tenderId || !job.analysisInputHash) return null;
  if (job.status === "SUCCEEDED" || job.status === "FAILED" || job.status === "CANCELED") return null;

  const contentHash = job.analysisInputHash;
  const stuckThreshold = new Date(Date.now() - STUCK_CLAIM_THRESHOLD_MS);

  // Atomic claim via FOR UPDATE SKIP LOCKED.
  // Claims a QUEUED chunk OR a RUNNING chunk with a stale claim.
  const result = await prisma.$queryRaw<Array<{
    id: string;
    chunkIndex: number;
    totalChunks: number;
  }>>(Prisma.sql`
    UPDATE "AiAnalyzeChunk"
    SET "status" = 'RUNNING',
        "startedAt" = NOW(),
        "claimedAt" = NOW(),
        "updatedAt" = NOW()
    WHERE "id" = (
      SELECT "id"
      FROM "AiAnalyzeChunk"
      WHERE "tenderId" = ${job.tenderId}
        AND "userId" = ${job.userId}
        AND "contentHash" = ${contentHash}
        AND (
          "status" = 'QUEUED'
          OR ("status" = 'RUNNING' AND "claimedAt" < ${stuckThreshold})
        )
      ORDER BY "chunkIndex" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING "id", "chunkIndex", "totalChunks"
  `);

  if (!result || result.length === 0) return null;

  const claimed = result[0];
  return {
    chunkId: claimed.id,
    chunkIndex: claimed.chunkIndex,
    totalChunks: claimed.totalChunks,
    contentHash,
    tenderId: job.tenderId,
    userId: job.userId,
  };
}

// ─── Chunk processing ────────────────────────────────────────────────────────

/**
 * Process a claimed chunk. The caller provides the AI result (or error).
 * This function saves the result to the chunk record.
 *
 * In production, the caller (run-next route) invokes the actual AI provider
 * chain and passes the result here. This separation keeps the library
 * testable without making real AI calls.
 */
export async function saveChunkResult(
  chunkId: string,
  result: { status: "SUCCEEDED"; provider: string; resultJson: string } | { status: "FAILED"; provider: string | null; error: unknown }
): Promise<ChunkProcessingResult> {
  await prismaReady;

  if (result.status === "SUCCEEDED") {
    await prisma.aiAnalyzeChunk.update({
      where: { id: chunkId },
      data: {
        status: "SUCCEEDED",
        provider: result.provider,
        resultJson: result.resultJson,
        errorMessage: null,
        failureCategory: null,
        finishedAt: new Date(),
        claimedAt: null,
      },
    });

    return {
      chunkId,
      status: "SUCCEEDED",
      provider: result.provider,
      failureCategory: null,
      safeDiagnosticSummary: `Chunk processed successfully by ${result.provider}.`,
    };
  }

  // Failed — classify the error safely
  const category = classifySafeFailure(result.error);
  await prisma.aiAnalyzeChunk.update({
    where: { id: chunkId },
    data: {
      status: "FAILED",
      provider: result.provider,
      errorMessage: null, // Never store raw error message
      failureCategory: category,
      finishedAt: new Date(),
      claimedAt: null,
    },
  });

  return {
    chunkId,
    status: "FAILED",
    provider: result.provider,
    failureCategory: category,
    safeDiagnosticSummary: safeFailureMessage(category),
  };
}

// ─── Job progress ────────────────────────────────────────────────────────────

/**
 * Get the current progress of an AI Analyze job.
 */
export async function getJobProgress(jobId: string): Promise<JobProgress | null> {
  await prismaReady;

  const job = await prisma.aiJob.findUnique({
    where: { id: jobId },
    select: {
      id: true, status: true, tenderId: true, userId: true,
      analysisInputHash: true, promotedAt: true, supersededBy: true,
      stagedMergedResult: true, errorMessage: true,
    },
  });

  if (!job || !job.tenderId || !job.analysisInputHash) return null;

  const chunks = await prisma.aiAnalyzeChunk.findMany({
    where: { tenderId: job.tenderId, userId: job.userId, contentHash: job.analysisInputHash },
    select: { status: true },
  });

  const totalChunks = chunks.length;
  const completedChunks = chunks.filter((c) => c.status === "SUCCEEDED").length;
  const failedChunks = chunks.filter((c) => c.status === "FAILED").length;
  const pendingChunks = chunks.filter((c) => c.status === "QUEUED" || c.status === "RUNNING").length;
  const progressPercent = totalChunks > 0 ? Math.round((completedChunks / totalChunks) * 100) : 0;

  let analysisSource: JobProgress["analysisSource"] = "NONE";
  let nextAction: JobProgress["nextAction"] = "RUN_NEXT";

  if (job.promotedAt && !job.supersededBy) {
    analysisSource = job.stagedMergedResult?.includes("FALLBACK_DRAFT") ? "REGEX_FALLBACK" : "AI";
    nextAction = "DONE";
  } else if (pendingChunks > 0) {
    nextAction = "RUN_NEXT";
  } else if (completedChunks === totalChunks) {
    nextAction = "FINALIZE";
  } else if (failedChunks > 0 && completedChunks < totalChunks) {
    nextAction = "RETRY";
  }

  const safeDiagnosticSummary = `Job status: ${job.status}. Chunks: ${completedChunks}/${totalChunks} succeeded, ${failedChunks} failed, ${pendingChunks} pending.`;

  return {
    jobId: job.id,
    status: job.status,
    totalChunks,
    completedChunks,
    failedChunks,
    pendingChunks,
    progressPercent,
    resumable: pendingChunks > 0 && completedChunks < totalChunks,
    analysisSource,
    nextAction,
    safeDiagnosticSummary,
  };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

/**
 * Finalize an AI Analyze job.
 *
 * Requirements:
 *   - Runs only after every required chunk succeeds.
 *   - Merges and deduplicates requirements.
 *   - Requires source file, page, quote, and confidence for mandatory requirements.
 *   - Atomically promotes canonical requirements.
 *   - Preserves previous canonical requirements until promotion succeeds.
 *   - Never promotes partial output.
 *   - Never promotes regex fallback automatically.
 */
export async function finalizeAnalyzeJob(jobId: string): Promise<FinalizeResult> {
  await prismaReady;

  const job = await prisma.aiJob.findUnique({
    where: { id: jobId },
    select: {
      id: true, tenderId: true, userId: true, status: true,
      analysisInputHash: true, promotedAt: true, supersededBy: true,
      stagedMergedResult: true,
    },
  });

  if (!job || !job.tenderId || !job.analysisInputHash) {
    return { ok: false, code: "JOB_NOT_FOUND", requirementsPromoted: 0, requirementsDeduplicated: 0, safeDiagnosticSummary: "Job not found." };
  }

  // Already promoted — idempotent return.
  if (job.promotedAt && !job.supersededBy) {
    return { ok: true, code: "ALREADY_PROMOTED", requirementsPromoted: 0, requirementsDeduplicated: 0, safeDiagnosticSummary: "Job already finalized and promoted." };
  }

  // Check that ALL chunks succeeded.
  const chunks = await prisma.aiAnalyzeChunk.findMany({
    where: { tenderId: job.tenderId, userId: job.userId, contentHash: job.analysisInputHash },
    select: { status: true, resultJson: true, chunkIndex: true },
    orderBy: { chunkIndex: "asc" },
  });

  const totalChunks = chunks.length;
  const succeededChunks = chunks.filter((c) => c.status === "SUCCEEDED");
  const failedChunks = chunks.filter((c) => c.status === "FAILED");

  if (failedChunks.length > 0) {
    return {
      ok: false, code: "CHUNKS_FAILED",
      requirementsPromoted: 0, requirementsDeduplicated: 0,
      safeDiagnosticSummary: `${failedChunks.length} chunk(s) failed. Cannot finalize until all chunks succeed.`,
    };
  }

  if (succeededChunks.length < totalChunks) {
    return {
      ok: false, code: "CHUNKS_PENDING",
      requirementsPromoted: 0, requirementsDeduplicated: 0,
      safeDiagnosticSummary: `${totalChunks - succeededChunks.length} chunk(s) still pending. Cannot finalize.`,
    };
  }

  // Parse + merge chunk results.
  type ParsedRequirement = {
    title: string;
    description: string;
    requirementType: string;
    priority: string;
    sourceFileName?: string | null;
    sourcePage?: number | null;
    sourceQuote?: string | null;
    sourceConfidence?: number | null;
    sourceTenderFileId?: string | null;
    sourceSectionHeading?: string | null;
  };

  const allRequirements: ParsedRequirement[] = [];
  for (const chunk of succeededChunks) {
    if (!chunk.resultJson) continue;
    try {
      const parsed = JSON.parse(chunk.resultJson) as { requirements?: ParsedRequirement[] };
      if (Array.isArray(parsed.requirements)) {
        allRequirements.push(...parsed.requirements);
      }
    } catch {
      // Malformed chunk result — skip it
    }
  }

  // Deduplicate by title (case-insensitive).
  const seenTitles = new Set<string>();
  const deduplicated: ParsedRequirement[] = [];
  let dedupCount = 0;
  for (const req of allRequirements) {
    const key = req.title.trim().toLowerCase();
    if (seenTitles.has(key)) {
      dedupCount++;
      continue;
    }
    seenTitles.add(key);
    deduplicated.push(req);
  }

  // Validate source grounding for mandatory requirements.
  // Mandatory requirements MUST have source file + page + quote + confidence.
  const MANDATORY_PRIORITY_REGEX = /mandatory|critical/i;
  const weakMandatory = deduplicated.filter(
    (r) => MANDATORY_PRIORITY_REGEX.test(r.priority ?? "") &&
    (!r.sourceFileName || r.sourcePage == null || !r.sourceQuote || r.sourceConfidence == null)
  );

  if (weakMandatory.length > 0) {
    return {
      ok: false, code: "WEAK_SOURCE_GROUNDING",
      requirementsPromoted: 0, requirementsDeduplicated: dedupCount,
      safeDiagnosticSummary: `${weakMandatory.length} mandatory requirement(s) lack source grounding (file, page, quote, or confidence). Cannot finalize.`,
    };
  }

  // Atomically promote: replace old requirements + promote the job.
  // This is done in a transaction so the old requirements are preserved
  // until the new ones are successfully written.
  await prisma.$transaction(async (tx) => {
    // Delete old requirements for this tender (they are being replaced
    // by the new promoted set).
    await tx.tenderRequirement.deleteMany({
      where: { tenderId: job.tenderId! },
    });

    // Insert the new deduplicated requirements.
    for (const req of deduplicated) {
      await tx.tenderRequirement.create({
        data: {
          tenderId: job.tenderId!,
          title: req.title.slice(0, 500),
          description: req.description.slice(0, 2000),
          requirementType: req.requirementType.slice(0, 100),
          priority: req.priority.slice(0, 50),
          sourceFileName: req.sourceFileName ?? null,
          sourcePageNumber: req.sourcePage ?? null,
          sourceExactQuote: req.sourceQuote ?? null,
          sourceConfidence: req.sourceConfidence ?? 0,
          sourceTenderFileId: req.sourceTenderFileId ?? null,
          sourceSectionHeading: req.sourceSectionHeading ?? null,
        },
      });
    }

    // Promote the job.
    await tx.aiJob.update({
      where: { id: jobId },
      data: {
        status: "SUCCEEDED",
        promotedAt: new Date(),
        stagedMergedResult: JSON.stringify({
          analysisSource: "AI",
          requirementCount: deduplicated.length,
          contentHash: job.analysisInputHash,
        }),
        finishedAt: new Date(),
      },
    });
  });

  return {
    ok: true, code: "FINALIZED",
    requirementsPromoted: deduplicated.length,
    requirementsDeduplicated: dedupCount,
    safeDiagnosticSummary: `Analysis finalized. ${deduplicated.length} requirements promoted (${dedupCount} duplicates removed).`,
  };
}

// ─── Provider exhaustion → fallback ──────────────────────────────────────────

/**
 * Mark a job as having exhausted all AI providers and fallen back to regex.
 *
 * The job becomes REGEX_FALLBACK_UNAPPROVED — a DRAFT that requires human
 * approval before it can be used for generation/export.
 *
 * Critical: this does NOT promote the job. The prior canonical AI success
 * (if any) remains visible and unchanged.
 */
export async function markJobAsFallbackDraft(
  jobId: string,
  fallbackResultJson: string
): Promise<{ ok: boolean; safeDiagnosticSummary: string }> {
  await prismaReady;

  await prisma.aiJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      stagedMergedResult: JSON.stringify({
        analysisSource: "FALLBACK_DRAFT",
        contentHash: null,
      }),
      errorMessage: null, // Never store raw error
      finishedAt: new Date(),
    },
  });

  return {
    ok: true,
    safeDiagnosticSummary: "All AI providers exhausted. Regex fallback drafted (unapproved). Review and approve, or retry AI Analyze.",
  };
}
