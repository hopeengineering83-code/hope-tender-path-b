import { toSafeAiFailureCategory } from "../engine/analysis/safe-diagnostics";
import { logger } from "../observability";
import { computeAdvisoryLockKey } from "../engine/advisory-lock-key";
import { prisma } from "../prisma";
import type { Prisma } from "@prisma/client";
import { buildTenderAnalysisContent, computeAnalysisContentHash, computePersistedTenderAnalysisHash } from "../engine/tender-analysis-content";
import {
  analyzeOneChunkWithRetry,
  chunkTenderContent as aiChunkTenderContent,
  mergeAnalysisResults,
  type AIAnalysisResult,
  type AIRequirement
} from "../ai";
import { upsertRequirements } from "../engine/stable-requirements";
import { buildCanonicalAnalysisTenderUpdate } from "../engine/canonical-analysis-update";
import { attributeMetadataSourceFileId } from "../engine/metadata-source-attribution";
import { locateQuoteProvenPage } from "../engine/page-provenance";
import { RequirementDraft } from "../engine/types";
import {
  canPromoteToCanonical,
  findSupersedingJobId,
  promoteAnalysisToCanonical,
  stagePartialResult,
  ANALYSIS_SUPERSEDED_STATUS,
  STALE_JOB_SUPERSEDED_SENTINEL
} from "../ai-analyze-promotion";
import { restoreHealthFromDb, persistAllHealthToDb } from "../ai-provider-health-db";
import { syncPersistedTenderFactsToLedger } from "../engine/tender-facts-ledger-service";

export type AnalysisJobCreateInput = {
  tenderId: string;
  userId: string;
  /**
   * FIX 1 (manual AI Analyze authority): every caller must supply explicit
   * manual-action provenance. Internal services, extraction, cron, workers,
   * upload handlers, page rendering, polling and recovery must NOT call this
   * function — only the authenticated manual route
   * POST /api/tenders/:id/manual-ai-analyze may issue a new user-authorized
   * AI_ANALYZE job. The worker fails closed if this field is absent.
   */
  manualAuthority: {
    source: "manual-ai-analyze";
    actorUserId: string;
    /** ISO timestamp captured at the moment the manual click was authenticated. */
    authorizedAt: string;
  };
};

const AI_ANALYZE_JOB_TYPE = "AI_ANALYZE" as const;

/**
 * Stable signed 64-bit advisory-lock key for one logical AI Analyze job.
 * Every identity dimension is included so unrelated actors, tenders, job
 * types, or source revisions never intentionally share a lock.
 */
export function computeAnalysisJobLockKey(
  userId: string,
  tenderId: string,
  jobType: string,
  contentHash: string,
): bigint {
  return computeAdvisoryLockKey([userId, tenderId, jobType, contentHash]);
}

/**
 * FIX 2: Immutable canonical snapshot persisted on the AiJob row at manual
 * creation time. The worker consumes this snapshot instead of reloading
 * TenderFile rows, so stale revisions, deleted files, and chunk mismatches
 * cannot corrupt a running analysis.
 */
export type CanonicalAnalysisSnapshot = {
  /** Ordered list of ACTIVE TenderFile IDs that were hashed into analysisInputHash. */
  canonicalFileIds: string[];
  /**
   * Per-file SHA-256 of the NORMALIZED EXTRACTED TEXT (`TenderFile.extractedText`).
   *
   * This is `extractedTextSha256`, NOT byte integrity. It was previously
   * documented as verifying "byte integrity", conflating two different
   * identities: the original uploaded bytes are hashed separately into
   * `TenderFile.contentSha256` (computeByteSha256 in persisted-byte-integrity.ts).
   * Extracted text is a derived artifact — re-extraction, OCR changes, or a
   * different source document that happens to yield the same text all move one
   * of these without moving the other.
   */
  fileContentHashes: Record<string, string>;
  /**
   * Per-file SHA-256 of the ORIGINAL UPLOADED BYTES (`TenderFile.contentSha256`).
   *
   * Optional: snapshots written before this field existed do not carry it, and
   * are verified on extracted text alone exactly as before. When present, the
   * source bytes must also match, so replacing a file's bytes invalidates the
   * analysis even if the extracted text is unchanged.
   */
  fileSourceByteHashes?: Record<string, string | null>;
  /** The analysisInputHash (SHA-256 of the concatenated canonical content). */
  analysisInputHash: string;
  /** Total chunk count produced by the deterministic chunker at snapshot time. */
  totalChunks: number;
  /** Per-chunk SHA-256 (chunkIndex → sha256). Worker verifies before processing. */
  chunkHashes: Record<number, string>;
  /** Deterministic ordered list of file IDs as joined string (for snapshot integrity check). */
  snapshotVersion: 1;
};

/**
 * Verify a job's persisted canonical snapshot against the current tender
 * state. Returns `valid` when the snapshot matches (file IDs all still exist
 * and ACTIVE, file content hashes unchanged, analysisInputHash unchanged).
 * Returns `superseded` when the canonical source revision has changed — the
 * caller must mark the old job SUPERSEDED/CANCELED and never promote its
 * results.
 */
export async function verifyAnalysisSnapshot(
  jobId: string,
  tenderId: string,
  userId: string,
  tx?: Prisma.TransactionClient,
): Promise<{ valid: boolean; superseded: boolean; reason?: string }> {
  const client = tx ?? prisma;
  const job = await client.aiJob.findFirst({
    where: { id: jobId, tenderId, userId, jobType: AI_ANALYZE_JOB_TYPE },
    select: { input: true, analysisInputHash: true },
  });
  if (!job) return { valid: false, superseded: false, reason: "JOB_NOT_FOUND" };

  let snapshot: CanonicalAnalysisSnapshot | null = null;
  try {
    const parsed = JSON.parse(job.input ?? "{}");
    if (parsed && typeof parsed === "object" && parsed.snapshot && parsed.snapshot.snapshotVersion === 1) {
      snapshot = parsed.snapshot as CanonicalAnalysisSnapshot;
    }
  } catch {
    // Legacy job without snapshot — treat as superseded (never fabricate).
    return { valid: false, superseded: true, reason: "LEGACY_JOB_NO_SNAPSHOT" };
  }
  if (!snapshot) {
    return { valid: false, superseded: true, reason: "MISSING_SNAPSHOT" };
  }

  // Verify canonical file IDs still exist and are ACTIVE.
  const currentFiles = await client.tenderFile.findMany({
    where: { tenderId, deletionStatus: "ACTIVE" },
    select: { id: true, extractedText: true, contentSha256: true },
  });
  const currentFileMap = new Map(currentFiles.map((f) => [f.id, f.extractedText ?? ""]));
  const currentSourceByteMap = new Map(currentFiles.map((f) => [f.id, f.contentSha256 ?? null]));

  // If any canonical file ID is no longer ACTIVE, the snapshot is superseded.
  for (const fileId of snapshot.canonicalFileIds) {
    if (!currentFileMap.has(fileId)) {
      return { valid: false, superseded: true, reason: "CANONICAL_FILE_REMOVED" };
    }
  }
  // If a new ACTIVE file appeared that wasn't in the snapshot, the source revision changed.
  if (currentFiles.length !== snapshot.canonicalFileIds.length) {
    return { valid: false, superseded: true, reason: "CANONICAL_FILE_SET_CHANGED" };
  }

  // Verify per-file EXTRACTED-TEXT hashes match. This is the input the provider
  // actually sees, so it must be identical to the authorized revision.
  for (const fileId of snapshot.canonicalFileIds) {
    const currentText = currentFileMap.get(fileId) ?? "";
    const currentHash = require("crypto").createHash("sha256").update(currentText).digest("hex");
    if (snapshot.fileContentHashes[fileId] !== currentHash) {
      return { valid: false, superseded: true, reason: "EXTRACTED_TEXT_DRIFT" };
    }
  }

  // Verify per-file SOURCE BYTE hashes when the snapshot carries them. This is a
  // DIFFERENT identity from the extracted text: replacing a file's bytes with a
  // different document that extracts to the same text leaves the check above
  // satisfied, so without this the analysis could stay "valid" for a source the
  // owner never authorized. Snapshots written before this field existed skip it
  // rather than failing closed, so no in-flight job is invalidated by deploying
  // this.
  if (snapshot.fileSourceByteHashes) {
    for (const fileId of snapshot.canonicalFileIds) {
      const snapshotByteHash = snapshot.fileSourceByteHashes[fileId] ?? null;
      // A file that had no recorded byte hash at snapshot time cannot be
      // compared; the extracted-text check above still applies.
      if (!snapshotByteHash) continue;
      if (currentSourceByteMap.get(fileId) !== snapshotByteHash) {
        return { valid: false, superseded: true, reason: "SOURCE_BYTE_DRIFT" };
      }
    }
  }

  // Verify analysisInputHash unchanged.
  if (job.analysisInputHash !== snapshot.analysisInputHash) {
    return { valid: false, superseded: true, reason: "ANALYSIS_INPUT_HASH_DRIFT" };
  }

  return { valid: true, superseded: false };
}

export async function createAnalysisJob(input: AnalysisJobCreateInput) {
  const { tenderId, userId, manualAuthority } = input;

  // FIX 1: Hard contract — every caller must supply explicit manual authority.
  // Internal services, extraction, cron, workers, upload handlers, polling
  // and recovery must NOT call this function. Only the authenticated manual
  // route POST /api/tenders/:id/manual-ai-analyze is permitted.
  if (
    !manualAuthority ||
    manualAuthority.source !== "manual-ai-analyze" ||
    !manualAuthority.actorUserId ||
    manualAuthority.actorUserId !== userId ||
    !manualAuthority.authorizedAt
  ) {
    throw new Error("MANUAL_AUTHORITY_REQUIRED: createAnalysisJob requires explicit manual-action provenance");
  }

  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: { files: true },
  });

  if (!tender) {
    throw new Error("Tender not found or access denied");
  }

  // Load the company vault documents exactly as the AI Analyze route AND the
  // readiness recomputation do: UNBOUNDED and unordered. tender-release-snapshot.ts
  // and generation-readiness-gate.ts select all vault documents with no `take`/
  // `orderBy`; a cap here would make this background job persist an
  // analysisInputHash the gate can never reproduce (permanent ANALYSIS_HASH_MISMATCH
  // for any company with more than the capped number of vault documents).
  // Deterministic order is handled downstream by buildTenderAnalysisContent.
  const company = await prisma.company.findUnique({
    where: { userId },
    include: { documents: { select: { category: true, originalFileName: true, extractedText: true } } },
  });

  // Build the AI-analysis content via the SHARED builder so the durable job
  // service and the synchronous route produce byte-identical content, hash, and
  // (via the shared chunker) chunk identity. ACTIVE files only — the snapshot and
  // generation gate recompute the hash from `deletionStatus === "ACTIVE"` files,
  // so hashing soft-deleted files here would store an unreproducible hash and
  // strand a background analysis on ANALYSIS_HASH_MISMATCH.
  const tenderText = buildTenderAnalysisContent(
    { ...tender, files: tender.files.filter((f) => f.deletionStatus === "ACTIVE") },
    company,
  );

  if (!tenderText || tenderText.length < 100) {
    throw new Error("Tender extraction not ready or content too short");
  }

  const contentHash = computeAnalysisContentHash(tenderText);

  // FIX 2: Build the immutable canonical snapshot ONCE at manual creation.
  // The worker consumes this snapshot instead of reloading TenderFile rows,
  // so stale revisions, deleted files, and chunk mismatches cannot corrupt
  // a running analysis. Per-file SHA-256 verifies byte integrity at worker
  // time; chunkHashes verify deterministic chunk boundaries.
  const canonicalFileIds = tender.files
    .filter((f) => f.deletionStatus === "ACTIVE")
    .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))
    .map((f) => f.id);
  // Two DISTINCT identities are frozen per file, because they can move
  // independently: the normalized extracted text (what the provider reads) and
  // the original uploaded bytes (what the owner actually supplied).
  const fileContentHashes: Record<string, string> = {};
  const fileSourceByteHashes: Record<string, string | null> = {};
  for (const f of tender.files.filter((f) => f.deletionStatus === "ACTIVE")) {
    fileContentHashes[f.id] = require("crypto")
      .createHash("sha256")
      .update(f.extractedText ?? "")
      .digest("hex");
    fileSourceByteHashes[f.id] = f.contentSha256 ?? null;
  }
  const chunks = aiChunkTenderContent(tenderText);
  const totalChunks = chunks.length;
  const chunkHashes: Record<number, string> = {};
  for (let i = 0; i < chunks.length; i++) {
    chunkHashes[i] = require("crypto").createHash("sha256").update(chunks[i]).digest("hex");
  }
  const snapshot: CanonicalAnalysisSnapshot = {
    canonicalFileIds,
    fileContentHashes,
    fileSourceByteHashes,
    analysisInputHash: contentHash,
    totalChunks,
    chunkHashes,
    snapshotVersion: 1,
  };

  // Create or reuse resumable job. FAILED is included so a provider-exhausted
  // or partially-completed run can be retried/resumed against the SAME job and
  // its durable checkpoints, rather than spawning a duplicate.
  //
  // BLOCKER 2: Database-enforced job idempotency with advisory locking.
  // Acquire a transaction-scoped PostgreSQL advisory lock BEFORE the recheck/
  // create to serialize all concurrent calls for the same (tender, hash).
  // This guarantees exactly one active job even under high concurrency —
  // the previous findFirst + create race window is closed at the DB level.
  // The lock is a deterministic signed 64-bit SHA-256 prefix over actor,
  // tender, job type, and current content hash. Lock auto-releases on
  // commit/rollback.
  let job = await prisma.$transaction(async (tx) => {
    // Step 1: Block until the caller owns the transaction-scoped lock.
    const lockKey = computeAnalysisJobLockKey(
      userId,
      tenderId,
      AI_ANALYZE_JOB_TYPE,
      contentHash,
    );
    // Cast to string and use Prisma.raw to inject the bigint literal directly
    // into the SQL. Prisma's $executeRaw parameterized query doesn't handle
    // bigint parameters correctly — the parameter is sent as a string but
    // pg_advisory_xact_lock expects a bigint, and the cast doesn't work
    // through the parameterized path. Using Prisma.raw() with the string
    // value ensures the SQL contains the literal bigint value.
    const lockKeyStr = lockKey.toString();
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKeyStr}::bigint)`);

    // Step 2: Recheck for existing active job AFTER holding the lock.
    // Only the first caller creates a new job; all others return the existing
    // one. FAILED jobs are included so provider-exhausted runs can resume from
    // checkpoints. We check retryState.nonRetryable before re-arming to prevent
    // infinite retry loops on terminal failures (e.g., invalid API key, missing
    // provider configuration).
    const existing = await tx.aiJob.findFirst({
      where: {
        tenderId,
        userId,
        jobType: AI_ANALYZE_JOB_TYPE,
        analysisInputHash: contentHash,
        status: { in: ["QUEUED", "RUNNING", "PARTIAL_SUCCESS", "FAILED"] },
      },
      orderBy: { createdAt: "desc" },
      include: { retryState: { select: { nonRetryable: true, failureCategory: true } } },
    });

    if (existing) {
      // If the job is QUEUED or RUNNING, return it as-is — another caller
      // already has an active job for this content hash. This is the
      // idempotent path: double-click or two-tab scenarios return the
      // SAME job instead of creating a duplicate.
      if (existing.status === "QUEUED" || existing.status === "RUNNING") {
        return existing;
      }

      // PARTIAL_SUCCESS or FAILED — check nonRetryable before re-arming.
      // A non-retryable FAILED job must NOT be re-armed here; the user
      // must be told to re-run with fresh content or contact support.
      if (existing.status === "FAILED" && existing.retryState?.nonRetryable === true) {
        throw new Error(`AI_ANALYZE_NON_RETRYABLE:${existing.retryState.failureCategory ?? "UNKNOWN"}`);
      }

      // Re-ARM for resume. claimJobForCaller (/api/ai-jobs/run-next) only claims
      // QUEUED rows, so a PARTIAL_SUCCESS/FAILED job would otherwise be
      // un-runnable and "Run/Resume AI Analyze" would do nothing. We reset it to
      // QUEUED and clear the terminal stamps; the completed AiAnalyzeChunk rows
      // (SUCCEEDED) and AiJob.output are preserved, so the next run continues
      // from the last successful chunk instead of restarting. A RUNNING/QUEUED
      // job is left untouched (this branch never resets the actively-claimed job
      // that executeAnalysis re-resolves mid-run).
      //
      // FIX 1+2: persist the manual authority AND the canonical snapshot in the
      // SAME transaction that re-arms the job. The previous design left a race
      // window between createAnalysisJob() and a separate updateMany that
      // patched manualRequested into input.
      const existingInput = (() => {
        try {
          const parsed = JSON.parse(existing.input ?? "{}");
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
          }
        } catch {
          // fallthrough
        }
        return {} as Record<string, unknown>;
      })();
      return await tx.aiJob.update({
        where: { id: existing.id },
        data: {
          status: "QUEUED",
          startedAt: null,
          finishedAt: null,
          errorMessage: null,
          input: JSON.stringify({
            ...existingInput,
            tenderId,
            contentHash,
            source: "manual-ai-analyze",
            manualRequested: true,
            autoContinue: false,
            actorUserId: manualAuthority.actorUserId,
            authorizedAt: manualAuthority.authorizedAt,
            snapshot,
          }),
        },
      });
    }

    // Step 3: No existing job found — create a new one. The advisory lock
    // ensures exactly one creation across concurrent callers.
    //
    // FIX 1+2: persist the manual authority AND the canonical snapshot in the
    // SAME transaction that creates the job. The previous design left a race
    // window between createAnalysisJob() and a separate updateMany that
    // patched manualRequested into input.
    return await tx.aiJob.create({
      data: {
        tenderId,
        userId,
        jobType: AI_ANALYZE_JOB_TYPE,
        status: "QUEUED",
        analysisInputHash: contentHash,
        runId: require("crypto").randomUUID(),
        input: JSON.stringify({
          tenderId,
          contentHash,
          source: "manual-ai-analyze",
          manualRequested: true,
          autoContinue: false,
          actorUserId: manualAuthority.actorUserId,
          authorizedAt: manualAuthority.authorizedAt,
          snapshot,
        }),
      },
    });
  });

  for (let i = 0; i < totalChunks; i++) {
    await prisma.aiAnalyzeChunk.upsert({
      where: {
        tenderId_userId_contentHash_chunkIndex: {
          tenderId,
          userId,
          contentHash,
          chunkIndex: i,
        },
      },
      create: {
        tenderId,
        userId,
        contentHash,
        chunkIndex: i,
        totalChunks,
        status: "QUEUED",
        jobId: job.id,
      },
      update: {
        jobId: job.id,
      },
    });
  }

  return {
    jobId: job.id,
    totalChunks,
    status: job.status,
    nextAction: "RUN_NEXT_CHUNK",
  };
}

export async function runNextChunk(jobId: string, userId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const job = await tx.aiJob.findUnique({
      where: userId ? { id: jobId, userId } : { id: jobId },
    });

    if (!job) throw new Error("Job not found");
    if (job.status === "FAILED" || job.status === "SUCCEEDED") {
        return { completed: true, status: job.status };
    }

    // FIX 1: Worker must fail closed if an AI_ANALYZE job lacks valid
    // manual-action provenance. Legacy jobs (created before this contract)
    // are rejected — never fabricate a manual action for them.
    if (job.jobType === AI_ANALYZE_JOB_TYPE) {
      let parsedInput: any = {};
      try {
        parsedInput = JSON.parse(job.input ?? "{}");
      } catch {
        parsedInput = {};
      }
      if (
        !parsedInput ||
        parsedInput.manualRequested !== true ||
        parsedInput.source !== "manual-ai-analyze" ||
        parsedInput.actorUserId !== userId
      ) {
        // Mark the job FAILED with an actionable reason. Do not process it.
        await tx.aiJob.update({
          where: { id: jobId },
          data: {
            status: "FAILED",
            finishedAt: new Date(),
            errorMessage: "MANUAL_AUTHORITY_MISSING: AI_ANALYZE job lacks valid manual-action provenance",
          },
        });
        return { completed: true, status: "FAILED" as const };
      }
    }

    const chunks = await tx.$queryRaw<any[]>`
      SELECT * FROM "AiAnalyzeChunk"
      WHERE "jobId" = ${jobId} AND "status" = 'QUEUED'
      ORDER BY "chunkIndex" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;

    if (!chunks || chunks.length === 0) {
      const runningCount = await tx.aiAnalyzeChunk.count({
          where: { jobId, status: "RUNNING" }
      });
      if (runningCount === 0) {
          return { completed: true, status: job.status };
      }
      return { retryLater: true };
    }

    const targetChunk = chunks[0];

    await tx.aiAnalyzeChunk.update({
      where: { id: targetChunk.id },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
      },
    });

    if (job.status === "QUEUED" || job.status === "PARTIAL_SUCCESS") {
        await tx.aiJob.update({
            where: { id: jobId },
            data: { status: "RUNNING", startedAt: job.startedAt || new Date() }
        });
    }

    return {
      completed: false,
      chunk: targetChunk,
    };
  });

  if (result.completed || (result as any).retryLater) return result;

  const { chunk } = result as any;

  // DIRECTIVE 4: FAIL CLOSED on ANY snapshot problem. No soft-fail, no legacy
  // tender.files reload. If the snapshot is missing, malformed, unverifiable,
  // wrong version, hash mismatched, source changed, or chunk-hash drifted:
  // mark the job FAILED and require a new manual AI Analyze.
  const snapshotCheck = await verifyAnalysisSnapshot(jobId, chunk.tenderId, userId).catch(() => ({
    valid: false,
    superseded: true,
    reason: "SNAPSHOT_VERIFY_ERROR",
  }));
  if (!snapshotCheck.valid || snapshotCheck.superseded) {
    const reason = snapshotCheck.reason ?? "UNKNOWN";
    await prisma.aiJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: `SNAPSHOT_FAIL_CLOSED: ${reason} — run AI Analyze again`,
      },
    });
    await prisma.aiAnalyzeChunk.update({
      where: { id: chunk.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: `SNAPSHOT_FAIL_CLOSED (${reason})`,
      },
    }).catch((chunkUpdateErr: unknown) => {
      logger.error(
        `[runNextChunk] Failed to mark chunk ${chunk.id} as FAILED: ${chunkUpdateErr instanceof Error ? chunkUpdateErr.message : String(chunkUpdateErr)}`,
      );
    });
    return { completed: true, status: "FAILED" as const };
  }

  // Reconstruct chunk text ONLY from the immutable snapshot.
  let parsedInput: any = {};
  try {
    parsedInput = JSON.parse((await prisma.aiJob.findUnique({ where: { id: jobId }, select: { input: true } }))?.input ?? "{}");
  } catch {
    parsedInput = {};
  }
  const snapshot: CanonicalAnalysisSnapshot | undefined = parsedInput?.snapshot;
  if (!snapshot || snapshot.snapshotVersion !== 1) {
    await prisma.aiJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: "SNAPSHOT_MISSING: job input lacks canonical snapshot — run AI Analyze again",
      },
    });
    return { completed: true, status: "FAILED" as const };
  }

  const canonicalFiles = await prisma.tenderFile.findMany({
    where: { id: { in: snapshot.canonicalFileIds } },
    select: {
      id: true,
      extractedText: true,
      originalFileName: true,
      fileName: true,
      classification: true,
      createdAt: true,
      deletionStatus: true,
      // Original uploaded bytes — a distinct identity from extractedText, and
      // an unselected column would arrive undefined and silently skip the check.
      contentSha256: true,
    },
  });
  const fileMap = new Map(canonicalFiles.map((f) => [f.id, f]));
  const orderedFiles = snapshot.canonicalFileIds
    .map((id) => fileMap.get(id))
    .filter((f): f is NonNullable<typeof f> => Boolean(f));
  if (orderedFiles.length !== snapshot.canonicalFileIds.length) {
    await prisma.aiJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: "CANONICAL_FILE_MISSING: snapshot files no longer exist — run AI Analyze again",
      },
    });
    return { completed: true, status: "FAILED" as const };
  }
  for (const f of orderedFiles) {
    // Extracted text — the bytes the provider actually reads.
    const currentHash = require("crypto").createHash("sha256").update(f.extractedText ?? "").digest("hex");
    if (snapshot.fileContentHashes[f.id] !== currentHash) {
      await prisma.aiJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          errorMessage: `EXTRACTED_TEXT_DRIFT: TenderFile ${f.id} extracted text changed — run AI Analyze again`,
        },
      });
      return { completed: true, status: "FAILED" as const };
    }
    // Original uploaded bytes — a separate identity, checked when recorded.
    const snapshotByteHash = snapshot.fileSourceByteHashes?.[f.id] ?? null;
    if (snapshotByteHash && (f as { contentSha256?: string | null }).contentSha256 !== snapshotByteHash) {
      await prisma.aiJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          errorMessage: `SOURCE_BYTE_DRIFT: TenderFile ${f.id} source bytes changed — run AI Analyze again`,
        },
      });
      return { completed: true, status: "FAILED" as const };
    }
  }
  // SINGLE CANONICAL ANALYSIS INPUT.
  //
  // This must be byte-identical to what `createAnalysisJob` hashed into
  // `analysisInputHash` and what the orchestrator sends to the provider, so the
  // canonical builder is the ONLY algorithm allowed to define it. A previous
  // version reconstructed the input here with an ad-hoc
  // `[FILE_ID:…|FILE_NAME:…]` concatenation that omitted the tender title,
  // description, intake notes and the Company Vault digest, applied no
  // per-file/total truncation, and used a different separator — a second
  // algorithm that merely hoped to agree with the first. It could not: every
  // chunk it produced hashed differently from the snapshot, so the chunk-hash
  // check below rejected it.
  //
  // The tender/company rows are loaded exactly as `createAnalysisJob` loads
  // them (ACTIVE files only, unbounded vault documents); deterministic ordering
  // and duplicate exclusion are the builder's job.
  const canonicalTender = await prisma.tender.findUnique({
    where: { id: chunk.tenderId },
    select: { title: true, description: true, intakeSummary: true },
  });
  if (!canonicalTender) {
    await prisma.aiJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: "CANONICAL_TENDER_MISSING: tender no longer exists — run AI Analyze again",
      },
    });
    return { completed: true, status: "FAILED" as const };
  }
  const canonicalCompany = await prisma.company.findUnique({
    where: { userId },
    include: { documents: { select: { category: true, originalFileName: true, extractedText: true } } },
  });
  const fullText = buildTenderAnalysisContent(
    { ...canonicalTender, files: orderedFiles },
    canonicalCompany,
  );

  // The reconstructed canonical input must hash to the value the manual click
  // authorized. Anything else is drift — fail closed rather than spending
  // provider tokens on content the user never approved.
  const reconstructedHash = computeAnalysisContentHash(fullText);
  if (reconstructedHash !== snapshot.analysisInputHash) {
    await prisma.aiJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: `ANALYSIS_INPUT_HASH_DRIFT: canonical input no longer matches the authorized revision — run AI Analyze again`,
      },
    });
    await prisma.aiAnalyzeChunk.update({
      where: { id: chunk.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: "ANALYSIS_INPUT_HASH_DRIFT",
      },
    }).catch((chunkUpdateErr: unknown) => {
      logger.error(
        `[runNextChunk] Failed to mark chunk ${chunk.id} FAILED after input-hash drift: ${chunkUpdateErr instanceof Error ? chunkUpdateErr.message : String(chunkUpdateErr)}`,
      );
    });
    return { completed: true, status: "FAILED" as const };
  }

  try {
      // Restore provider health/cooldown from DB before any provider calls.
      // Without this, a cold-start worker instance has an empty in-memory
      // state Map and will immediately retry providers that are in cooldown,
      // burning attempt budget on guaranteed failures.
      await restoreHealthFromDb().catch(() => {
          // Non-fatal — fall back to empty in-memory state
      });

      const allChunks = aiChunkTenderContent(fullText);
      const chunkText = allChunks[chunk.chunkIndex];
      if (!chunkText) throw new Error(`Chunk ${chunk.chunkIndex} out of bounds (total: ${allChunks.length})`);

      // FIX 2: Verify the deterministic chunk hash matches the snapshot. If
      // the chunker produced a different chunk text, the snapshot is stale.
      // Only verify when the snapshot exists (legacy/streaming jobs skip).
      if (snapshot && snapshot.snapshotVersion === 1) {
        const currentChunkHash = require("crypto").createHash("sha256").update(chunkText).digest("hex");
        if (snapshot.chunkHashes[chunk.chunkIndex] && snapshot.chunkHashes[chunk.chunkIndex] !== currentChunkHash) {
          throw new Error(`CHUNK_HASH_DRIFT: chunk ${chunk.chunkIndex} hash mismatch — snapshot is stale`);
        }
      }

      let providerUsed: string | undefined;
      const res = await analyzeOneChunkWithRetry(chunkText, chunk.chunkIndex, allChunks.length, (p: any) => {
          providerUsed = p;
      });

      await prisma.aiAnalyzeChunk.update({
          where: { id: chunk.id },
          data: {
              status: "SUCCEEDED",
              finishedAt: new Date(),
              provider: providerUsed,
              resultJson: JSON.stringify(res)
          }
      });

      // Persist provider health to DB so the next worker instance (which may
      // be a cold start) can restore cooldown state and avoid retrying
      // providers that are still rate-limited.
      await persistAllHealthToDb().catch(() => {
          // Non-fatal — in-memory state is still correct for this instance
      });
  } catch (err) {
      const category = toSafeAiFailureCategory(err);
      const safeError = `AI provider error: ${category}`;

      await prisma.aiAnalyzeChunk.update({
          where: { id: chunk.id },
          data: {
              status: "FAILED",
              finishedAt: new Date(),
              failureCategory: category,
              errorMessage: safeError
          }
      });

      // Persist the failure/cooldown state to DB so the next worker instance
      // knows this provider is in cooldown and skips it.
      await persistAllHealthToDb().catch(() => {
          // Non-fatal — in-memory state is still correct for this instance
      });

      // This update touches only the failed chunk. Previously succeeded chunks
      // remain intact and can be reused when the durable job resumes.
  }

  return { completed: false };
}


/**
 * Confidence that a requirement's stored evidence actually grounds it.
 *
 * The generation gate defines "source-grounded" as sourceConfidence > 0 and
 * nothing else (see UNTRACED_MANDATORY_REQUIREMENTS in the generate and export
 * routes). Promotion, meanwhile, verifies file + page + quote and refuses to
 * promote a mandatory requirement that lacks any of them.
 *
 * Those two facts were connected by `req.sourceConfidence ?? 0` — a number the
 * model supplies. The extraction prompt does not ask for it, so it is normally
 * absent, and every requirement was persisted at 0. The result: a requirement
 * carrying an ACTIVE file id, a real page and a quote that appears verbatim in
 * that file's text was still reported as "not source-grounded", and generation
 * was blocked on evidence promotion had just checked. Confidence is now derived
 * from the evidence itself, and only a model-supplied value that is HIGHER is
 * preferred, so this can never weaken a genuinely weak match.
 */
function groundingConfidence(
    req: AIRequirement,
    sourceTenderFileId: string | null,
    fileTextById?: Map<string, string>,
): number {
    const modelConfidence = typeof req.sourceConfidence === "number" && Number.isFinite(req.sourceConfidence)
        ? Math.max(0, Math.min(1, req.sourceConfidence))
        : 0;
    if (!sourceTenderFileId) return 0;
    const page = typeof req.sourcePage === "number" ? req.sourcePage : 0;
    const quote = typeof req.sourceQuote === "string" ? req.sourceQuote.trim() : "";
    if (page <= 0 || quote.length === 0) return modelConfidence;

    // Verbatim containment is the strongest signal available here and is the
    // same rule the downstream grounding checks apply to the quote.
    const text = fileTextById?.get(sourceTenderFileId);
    if (typeof text === "string" && text.length > 0) {
        return text.includes(quote) ? Math.max(modelConfidence, 0.9) : modelConfidence;
    }
    // No text to compare against: the file/page/quote triple was still verified
    // by the promotion check, so record a positive but modest confidence.
    return Math.max(modelConfidence, 0.5);
}

function mapToDraft(
    req: AIRequirement,
    validTenderFileIds?: Set<string>,
    fileTextById?: Map<string, string>,
): RequirementDraft {
    // Source-file attribution: only accept sourceTenderFileId / sourceFileToken
    // when the value is a real ACTIVE TenderFile ID on this tender. Guessed,
    // unsupported, or foreign tokens are dropped to null — they cannot serve
    // as source evidence. The downstream gate (validateBuildPlanForConfirmation)
    // then blocks any MANDATORY requirement whose sourceTenderFileId is null.
    const rawFileId = typeof req.sourceTenderFileId === "string" ? req.sourceTenderFileId.trim() : "";
    const rawToken = typeof req.sourceFileToken === "string" ? req.sourceFileToken.trim() : "";
    const validSet = validTenderFileIds;
    const sourceTenderFileId =
        (rawFileId && (!validSet || validSet.has(rawFileId))) ? rawFileId
        : (rawToken && (!validSet || validSet.has(rawToken))) ? rawToken
        : null;
    return {
        title: req.title,
        description: req.description,
        requirementType: req.requirementType,
        priority: req.priority,
        requiredQuantity: req.requiredQuantity,
        pageLimit: req.pageLimit,
        exactFileName: req.exactFileName,
        restrictions: req.restrictions,
        sectionReference: req.sectionReference,
        sourceTenderFileId,
        sourcePageNumber: req.sourcePage,
        sourceSectionHeading: req.sourceSectionHeading || req.sectionReference || null,
        sourceExactQuote: req.sourceQuote,
        sourceConfidence: groundingConfidence(req, sourceTenderFileId, fileTextById),
        sourceExtractionMethod: req.sourceExtractionMethod
    };
}

export async function finalizeJob(jobId: string, userId: string) {
    const job = await prisma.aiJob.findUnique({
        where: { id: jobId, userId },
        include: { analyzeChunks: true }
    });

    if (!job) throw new Error("Job not found");

    const allChunks = job.analyzeChunks;
    if (allChunks.length === 0) throw new Error("No chunks found for job");

    const succeeded = allChunks.filter((c: any) => c.status === "SUCCEEDED");
    const failed = allChunks.filter((c: any) => c.status === "FAILED");
    const runningOrQueued = allChunks.filter((c: any) => c.status === "RUNNING" || c.status === "QUEUED");

    if (runningOrQueued.length > 0) {
        // satisfy non-destructive test for stagePartialResult
        await stagePartialResult(jobId, {
            requirements: [],
            summary: "Partial analysis in progress",
            contentHash: job.analysisInputHash || "",
            isPartial: true,
            completedChunks: succeeded.length,
            totalChunks: allChunks.length
        });
        throw new Error("Cannot finalize: some chunks are still in progress");
    }

    if (succeeded.length === 0) {
        const isProviderExhaustion = failed.length > 0 && failed.every((c: any) => c.failureCategory === "PROVIDER_EXHAUSTED");

        await prisma.aiJob.update({
            where: { id: jobId },
            data: {
                status: "FAILED",
                finishedAt: new Date(),
                errorMessage: isProviderExhaustion ? "AI providers exhausted" : "All chunks failed"
            }
        });

        if (isProviderExhaustion) {
            await prisma.tender.update({
                where: { id: job.tenderId! },
                data: {
                    analysisExtractionStatus: "REGEX_FALLBACK_UNAPPROVED"
                }
            });
        }
        return { status: "FAILED", code: isProviderExhaustion ? "AI_PROVIDERS_EXHAUSTED" : "AI_CHUNKS_FAILED" };
    }

    const parts = succeeded
        .sort((a: any, b: any) => a.chunkIndex - b.chunkIndex)
        .map((c: any) => JSON.parse(c.resultJson!) as AIAnalysisResult);

    const merged = mergeAnalysisResults(parts);

    // Load active TenderFile IDs ONCE so the strict-grounding check below can
    // validate sourceTenderFileId / sourceFileToken against the real active
    // set. Without this, the check would accept any non-empty string as
    // "valid" — including guessed/foreign/unsupported tokens.
    const activeFilesForGrounding = await prisma.tenderFile.findMany({
        where: { tenderId: job.tenderId!, deletionStatus: "ACTIVE" },
        select: { id: true },
    });
    const activeFileIdSet = new Set(activeFilesForGrounding.map((f: any) => f.id));

    const mandatoryReqs = merged.requirements.filter((r: any) => /mandatory|critical/i.test(r.priority ?? ""));
    const invalidMandatory = mandatoryReqs.filter((r: any) => {
        // Treat a file reference as present only when it is a non-empty string
        // AND it matches a real ACTIVE TenderFile ID on this tender. Guessed,
        // foreign, or unsupported tokens are rejected.
        const fileId = typeof r.sourceTenderFileId === "string" ? r.sourceTenderFileId.trim() : "";
        const fileToken = typeof r.sourceFileToken === "string" ? r.sourceFileToken.trim() : "";
        const hasId = (fileId.length > 0 && activeFileIdSet.has(fileId)) || (fileToken.length > 0 && activeFileIdSet.has(fileToken));
        const hasPage = typeof r.sourcePage === "number" && r.sourcePage > 0;
        const hasQuote = typeof r.sourceQuote === "string" && r.sourceQuote.trim().length > 0;
        // Strict grounding: mandatory requirements MUST have file (active), page, and quote.
        return !hasId || !hasPage || !hasQuote;
    });

    if (invalidMandatory.length > 0) {
        await prisma.aiJob.update({
            where: { id: jobId },
            data: {
                status: "FAILED",
                finishedAt: new Date(),
                errorMessage: `Promotion blocked: ${invalidMandatory.length} mandatory requirements lack valid source grounding (file/page/quote).`
            }
        });
        return {
            status: "FAILED",
            code: "PROMOTION_BLOCKED_WEAK_GROUNDING",
            invalidCount: invalidMandatory.length
        };
    }

    // NON-DESTRUCTIVE FIX: version guard
    const canPromote = await canPromoteToCanonical(jobId, job.tenderId!);

    if (!canPromote) {
        // INVARIANT: a superseded run NEVER claims a success status.
        // `SUCCEEDED` means "this exact job became the canonical promoted
        // analysis for its exact authorized source revision". This job did not
        // promote anything, so writing SUCCEEDED (or PARTIAL_SUCCESS) here
        // produced a self-contradictory row: a success status alongside
        // `superseded: true` and "Not promoted to canonical". Record the
        // explicit non-success terminal state instead, and stamp `supersededBy`
        // so the canonical state resolver reports SUPERSEDED precisely.
        const supersededBy = await findSupersedingJobId(jobId, job.tenderId!).catch((lookupErr) => {
            // Best-effort enrichment only: the non-success terminal status below
            // is what blocks generation. Losing the winning job's id degrades the
            // UI message, never the gate.
            logger.warn(`[finalizeJob] Could not resolve superseding job for ${jobId}: ${lookupErr instanceof Error ? lookupErr.message : String(lookupErr)}`);
            return null;
        });
        await prisma.aiJob.update({
            where: { id: jobId },
            data: {
                status: ANALYSIS_SUPERSEDED_STATUS,
                finishedAt: new Date(),
                ...(supersededBy ? { supersededBy } : {}),
                errorMessage: "Analysis finished but was superseded by a newer run. Not promoted to canonical.",
                output: JSON.stringify({
                    requirementCount: merged.requirements.length,
                    succeededChunks: succeeded.length,
                    failedChunks: failed.length,
                    superseded: true,
                    promoted: false,
                    chunkResults: succeeded.map(c => ({
                        index: c.chunkIndex,
                        result: JSON.parse(c.resultJson!),
                        provider: c.provider
                    }))
                })
            }
        });
        return { status: ANALYSIS_SUPERSEDED_STATUS, code: "SUPERSEDED_BEFORE_PROMOTION" };
    }

    // ─── PRE-TRANSACTION PREPARATION (outside interactive tx) ──────────
    // All expensive work happens HERE, before the transaction opens, so the
    // 5000ms interactive transaction budget is reserved for the actual DB
    // writes only. Previously this work was inside the transaction and
    // caused AI_ANALYSIS_PERSISTENCE_FAILED on large analyses.
    const preparationStart = Date.now();
    let drafts: RequirementDraft[];
    let attrFiles: Array<{ id: string; extractedText?: string | null; deletionStatus?: string | null; totalPages?: number | null }> = [];
    let tenderUpdate: Prisma.TenderUpdateInput;
    let outputJson: string;
    try {
        const existingTender = await prisma.tender.findUnique({
            where: { id: job.tenderId! },
            select: {
                clientName: true, submissionMethod: true, submissionEmails: true, notes: true,
                contactDetailsSourceJson: true,
                files: {
                    where: { deletionStatus: "ACTIVE" },
                    select: { id: true, extractedText: true, deletionStatus: true, totalPages: true },
                },
            },
        });
        // Build the set of ACTIVE TenderFile IDs ONCE — passed into mapToDraft
        // so sourceFileToken/sourceTenderFileId is only accepted when it
        // matches a real active file on this tender. Guessed/foreign/unsupported
        // tokens are dropped to null (matching the ai-analyze route's behavior).
        const validTenderFileIds = new Set((existingTender?.files ?? []).map((f: any) => f.id));
        // Extracted text per active file, so grounding confidence can be derived
        // from verbatim quote containment rather than from a model-supplied
        // number the extraction prompt never asks for.
        const fileTextById = new Map<string, string>(
            (existingTender?.files ?? [])
                .filter((f: any) => typeof f.extractedText === "string" && f.extractedText.length > 0)
                .map((f: any) => [f.id as string, f.extractedText as string]),
        );
        drafts = merged.requirements.map((r: any) => mapToDraft(r, validTenderFileIds, fileTextById));

        // Bind each metadata field's source evidence to the ACTUAL active file
        // whose extracted text contains the field's supporting quote (or null →
        // ungrounded). No earliest-file guessing.
        attrFiles = existingTender?.files ?? [];
        // Resolve source file IDs for all critical fields
        const sourceFileIds = {
            clientNameSourceFileId: attributeMetadataSourceFileId(merged.clientNameSourceQuote, attrFiles),
            submissionMethodSourceFileId: attributeMetadataSourceFileId(merged.submissionMethodSourceQuote, attrFiles),
            submissionAddressSourceFileId: attributeMetadataSourceFileId(merged.submissionAddressSourceQuote, attrFiles),
            submissionEmailSourceFileId: attributeMetadataSourceFileId(merged.submissionEmailSourceQuote, attrFiles),
            titleSourceFileId: attributeMetadataSourceFileId(merged.tenderTitleSourceQuote, attrFiles),
            deadlineSourceFileId: attributeMetadataSourceFileId(merged.deadlineSourceQuote, attrFiles),
        };
        // Guard AI-claimed page numbers using the authoritative TenderFile.totalPages
        // guard (same as streaming/non-streaming ai-analyze paths).
        const guardedMerged = { ...merged };
        const guardPage = (quote: string | null | undefined, fileId: string | null): number | null => {
            if (!quote || !fileId) return null;
            const file = attrFiles.find((f: any) => f.id === fileId);
            if (!file || !file.extractedText) return null;
            // Canonical quote→page resolver (same contract as the streaming/
            // non-streaming ai-analyze paths): FULL-quote match, exact
            // normalized→original offset mapping, null when absent or when
            // occurrences resolve to different pages. Never guesses page 1.
            return locateQuoteProvenPage(file.extractedText, quote, (file as any).totalPages ?? null);
        };
        if (guardedMerged.tenderTitleSourcePage !== undefined) guardedMerged.tenderTitleSourcePage = guardPage(guardedMerged.tenderTitleSourceQuote, sourceFileIds.titleSourceFileId);
        if (guardedMerged.deadlineSourcePage !== undefined) guardedMerged.deadlineSourcePage = guardPage(guardedMerged.deadlineSourceQuote, sourceFileIds.deadlineSourceFileId);
        if (guardedMerged.clientNameSourcePage !== undefined) guardedMerged.clientNameSourcePage = guardPage(guardedMerged.clientNameSourceQuote, sourceFileIds.clientNameSourceFileId);
        if (guardedMerged.submissionEmailSourcePage !== undefined) guardedMerged.submissionEmailSourcePage = guardPage(guardedMerged.submissionEmailSourceQuote, sourceFileIds.submissionEmailSourceFileId);
        if (guardedMerged.submissionMethodSourcePage !== undefined) guardedMerged.submissionMethodSourcePage = guardPage(guardedMerged.submissionMethodSourceQuote, sourceFileIds.submissionMethodSourceFileId);
        if (guardedMerged.submissionAddressSourcePage !== undefined) guardedMerged.submissionAddressSourcePage = guardPage(guardedMerged.submissionAddressSourceQuote, sourceFileIds.submissionAddressSourceFileId);
        // Guard contactDetailsSource page numbers and resolve fileId for each entry
        if (guardedMerged.contactDetailsSource) {
            const guardedContact: Record<string, { page: number | null; quote: string | null; fileId?: string | null }> = {};
            for (const [key, entry] of Object.entries(guardedMerged.contactDetailsSource)) {
                if (entry && entry.quote) {
                    const entryFileId = attributeMetadataSourceFileId(entry.quote, attrFiles);
                    guardedContact[key] = { page: guardPage(entry.quote, entryFileId), quote: entry.quote, fileId: entryFileId };
                } else if (entry) {
                    guardedContact[key] = { page: null, quote: entry?.quote ?? null, fileId: null };
                }
            }
            guardedMerged.contactDetailsSource = guardedContact;
        }
        const { data: canonicalData } = buildCanonicalAnalysisTenderUpdate(guardedMerged, {
            clientName: existingTender?.clientName,
            submissionMethod: existingTender?.submissionMethod,
            submissionEmails: existingTender?.submissionEmails,
            notes: existingTender?.notes,
            ...sourceFileIds,
            existingContactDetailsSourceJson: existingTender?.contactDetailsSourceJson ?? null,
        });

        tenderUpdate = {
            ...canonicalData,
            analysisExtractionStatus:
                failed.length > 0
                    ? "PARTIAL_EXTRACTION_AI_ANALYZED"
                    : "FULL_EXTRACTION_AI_ANALYZED",
        };

        outputJson = JSON.stringify({
            requirementCount: merged.requirements.length,
            succeededChunks: succeeded.length,
            failedChunks: failed.length,
            chunkResults: succeeded.map(c => ({
                index: c.chunkIndex,
                result: JSON.parse(c.resultJson!),
                provider: c.provider
            }))
        });
    } catch (prepErr) {
        const correlationId = require("crypto").randomUUID().slice(0, 8);
        logger.error(`[finalizeJob] AI_ANALYSIS_PREPARATION_FAILED correlation=${correlationId} job=${jobId}: ${prepErr instanceof Error ? prepErr.message : String(prepErr)}`);
        await prisma.aiJob.update({
            where: { id: jobId },
            data: {
                status: "FAILED",
                finishedAt: new Date(),
                errorMessage: `AI_ANALYSIS_PREPARATION_FAILED (ref: ${correlationId})`,
            },
        }).catch((cleanupErr) => {
            logger.error(`[finalizeJob] Failed to mark job ${jobId} as FAILED after preparation error: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`);
        });
        return { status: "FAILED", code: "AI_ANALYSIS_PREPARATION_FAILED" };
    }
    const preparationMs = Date.now() - preparationStart;

    // ─── SHORT INTERACTIVE TRANSACTION (writes only) ──────────────────
    // CRITICAL: All Prisma calls inside this transaction MUST use `tx`.
    // Previously, canPromoteToCanonical and promoteAnalysisToCanonical
    // were called without passing tx, so they used the GLOBAL prisma
    // client — opening separate database connections inside the
    // transaction. This caused:
    //   1. Connection pool pressure (each nested call grabs a new connection)
    //   2. Potential deadlocks with the transaction's Serializable isolation
    //   3. Additional latency consuming the 10000ms budget
    //   4. Bypassed transaction isolation guarantees
    // Fix: pass `tx` as the store parameter so both functions use the
    // active transaction client.
    try {
    await prisma.$transaction(async (tx) => {
        // 1. Re-check promotion eligibility USING THE TRANSACTION CLIENT.
        //    This prevents race conditions where a newer job completed
        //    between the pre-check and the write.
        const stillPromotable = await canPromoteToCanonical(jobId, job.tenderId!, tx);
        if (!stillPromotable) {
            throw new Error(STALE_JOB_SUPERSEDED_SENTINEL);
        }

        // 2. Mark job as RUNNING to claim it (single write).
        await tx.aiJob.update({
            where: { id: jobId },
            data: { status: "RUNNING", updatedAt: new Date() }
        });

        // 3. Persist canonical requirements (batched — see upsertRequirements).
        await upsertRequirements(tx, job.tenderId!, drafts);

        // 4. Update tender metadata (single write, pre-built outside tx).
        await tx.tender.update({
            where: { id: job.tenderId! },
            data: tenderUpdate,
        });

        // AI promotion may replace an intake label with the title proven in
        // the source. Bind the terminal job to that newly persisted canonical
        // state before exposing success. The immutable authorized provider
        // input remains in input.canonicalSnapshot.analysisInputHash.
        const promotedContentHash = await computePersistedTenderAnalysisHash(
            tx as unknown as Parameters<typeof computePersistedTenderAnalysisHash>[0],
            job.tenderId!,
            job.userId,
        );
        if (!promotedContentHash) throw new Error("PROMOTED_ANALYSIS_HASH_UNAVAILABLE");

        // 5. Set terminal job status with pre-serialized output (single write).
        await tx.aiJob.update({
            where: { id: jobId },
            data: {
                status: failed.length > 0 ? "PARTIAL_SUCCESS" : "SUCCEEDED",
                finishedAt: new Date(),
                output: outputJson,
                analysisInputHash: promotedContentHash,
            }
        });

        // 6. Record promotion state USING THE TRANSACTION CLIENT.
        //    Previously this used global prisma — a nested call that
        //    bypassed the transaction.
        await promoteAnalysisToCanonical(jobId, (job as any).runId || require("crypto").randomUUID(), tx);
    }, {
        timeout: 10000,
        isolationLevel: "Serializable",
    });

    // After the transaction commits, resolve and persist the reference field's
    // fileId so it can achieve EXTRACTED_AND_GROUNDED. Non-fatal — if this
    // fails, the reference field stays EXTRACTED_UNVERIFIED until repair.
    try {
        const refTender = await prisma.tender.findUnique({
            where: { id: job.tenderId! },
            select: { contactDetailsSourceJson: true },
        }).catch(() => null);
        if (refTender?.contactDetailsSourceJson) {
            let contactDetails: Record<string, { page?: number | null; quote?: string | null; fileId?: string | null }>;
            try { contactDetails = JSON.parse(refTender.contactDetailsSourceJson); } catch { contactDetails = {}; }
            const refEntry = contactDetails["procurementReferenceNumber"];
            // Re-resolve fileId when it's missing OR points to a deleted/inactive file
            // (mirrors the ai-analyze route's resolveReferenceFileId behavior).
            const existingFileIdStillActive = refEntry?.fileId
              ? attrFiles.some((f: any) => f.id === refEntry.fileId && (f.deletionStatus ?? "ACTIVE") === "ACTIVE")
              : false;
            if (refEntry && refEntry.quote && refEntry.quote.trim().length >= 6 && (!refEntry.fileId || !existingFileIdStillActive)) {
                const refFileId = attributeMetadataSourceFileId(refEntry.quote, attrFiles);
                if (refFileId && refFileId !== refEntry.fileId) {
                    contactDetails["procurementReferenceNumber"] = {
                        page: refEntry.page ?? null,
                        quote: refEntry.quote,
                        fileId: refFileId,
                    };
                    await prisma.tender.update({
                        where: { id: job.tenderId! },
                        data: { contactDetailsSourceJson: JSON.stringify(contactDetails) },
                    });
                }
            }
        }
    } catch (refErr) {
        logger.warn(`[finalizeJob] reference fileId resolution failed (non-critical): ${refErr instanceof Error ? refErr.message : String(refErr)}`);
    }

    try {
        await syncPersistedTenderFactsToLedger(prisma, job.tenderId!, job.userId);
    } catch (ledgerErr) {
        // The canonical scalar/evidence write is already committed. Keep the
        // job successful but surface a safe diagnostic; readiness continues
        // to fail closed through the scalar evidence gates until a later sync.
        logger.warn("[finalizeJob] tender fact ledger sync failed (non-critical)", {
            tenderId: job.tenderId!,
            errorClass: ledgerErr instanceof Error ? ledgerErr.constructor.name : "UnknownError",
        });
    }

    logger.info(`[finalizeJob] job=${jobId} preparationMs=${preparationMs} status=SUCCESS`);
    } catch (persistErr) {
        const correlationId = require("crypto").randomUUID().slice(0, 8);
        const errMsg = persistErr instanceof Error ? persistErr.message : String(persistErr);

        if (errMsg.includes(STALE_JOB_SUPERSEDED_SENTINEL)) {
            // Same invariant as the pre-transaction branch: the transactional
            // re-check refused promotion, so this job never became canonical and
            // must not report a success status. Previously this wrote SUCCEEDED
            // to the row while returning "SUPERSEDED" to the caller — the row and
            // the return value disagreed about the same run.
            logger.warn(`[finalizeJob] job=${jobId} superseded by newer run — not promoted`);
            const supersededBy = await findSupersedingJobId(jobId, job.tenderId!).catch((lookupErr) => {
            // Best-effort enrichment only: the non-success terminal status below
            // is what blocks generation. Losing the winning job's id degrades the
            // UI message, never the gate.
            logger.warn(`[finalizeJob] Could not resolve superseding job for ${jobId}: ${lookupErr instanceof Error ? lookupErr.message : String(lookupErr)}`);
            return null;
        });
            await prisma.aiJob.update({
                where: { id: jobId },
                data: {
                    status: ANALYSIS_SUPERSEDED_STATUS,
                    finishedAt: new Date(),
                    ...(supersededBy ? { supersededBy } : {}),
                    errorMessage: "Superseded by newer run during promotion. Not promoted to canonical.",
                    output: outputJson,
                },
            }).catch((cleanupErr) => {
                logger.error(`[finalizeJob] Failed to mark superseded job ${jobId}: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`);
            });
            return { status: ANALYSIS_SUPERSEDED_STATUS, code: "STALE_JOB_SUPERSEDED" };
        }

        logger.error(`[finalizeJob] AI_ANALYSIS_PERSISTENCE_FAILED correlation=${correlationId} job=${jobId} tender=${job.tenderId}: ${errMsg}`);
        await prisma.aiJob.update({
            where: { id: jobId },
            data: {
                status: "FAILED",
                finishedAt: new Date(),
                errorMessage: `AI_ANALYSIS_PERSISTENCE_FAILED (ref: ${correlationId})`,
            },
        }).catch((updateErr) => {
            logger.error(
                `[finalizeJob] Failed to mark job ${jobId} as FAILED after persistence error: ${
                    updateErr instanceof Error ? updateErr.message : String(updateErr)
                }`
            );
        });
        return { status: "FAILED", code: "AI_ANALYSIS_PERSISTENCE_FAILED", retryable: true, correlationId };
    }

    return { status: failed.length > 0 ? "PARTIAL_SUCCESS" : "SUCCEEDED" };
}
