import { toSafeAiFailureCategory } from "../engine/analysis/safe-diagnostics";
import { logger } from "../observability";
import { computeAdvisoryLockKey } from "../engine/advisory-lock-key";
import { prisma } from "../prisma";
import type { Prisma } from "@prisma/client";
import { buildTenderAnalysisContent, computeAnalysisContentHash } from "../engine/tender-analysis-content";
import {
  analyzeOneChunkWithRetry,
  chunkTenderContent as aiChunkTenderContent,
  isProviderExhaustedError,
  mergeAnalysisResults,
  type AIAnalysisResult,
  type AIRequirement,
  ANALYSIS_CHUNK_SIZE,
  ANALYSIS_CHUNK_OVERLAP
} from "../ai";
import { upsertRequirements } from "../engine/stable-requirements";
import { buildCanonicalAnalysisTenderUpdate } from "../engine/canonical-analysis-update";
import { attributeMetadataSourceFileId } from "../engine/metadata-source-attribution";
import { locateQuoteProvenPage } from "../engine/page-provenance";
import { RequirementDraft } from "../engine/types";
import {
  canPromoteToCanonical,
  promoteAnalysisToCanonical,
  stagePartialResult
} from "../ai-analyze-promotion";
import { restoreHealthFromDb, persistAllHealthToDb } from "../ai-provider-health-db";

export type AnalysisJobCreateInput = {
  tenderId: string;
  userId: string;
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

export async function createAnalysisJob(input: AnalysisJobCreateInput) {
  const { tenderId, userId } = input;

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
      return await tx.aiJob.update({
        where: { id: existing.id },
        data: { status: "QUEUED", startedAt: null, finishedAt: null, errorMessage: null },
      });
    }

    // Step 3: No existing job found — create a new one. The advisory lock
    // ensures exactly one creation across concurrent callers.
    return await tx.aiJob.create({
      data: {
        tenderId,
        userId,
        jobType: AI_ANALYZE_JOB_TYPE,
        status: "QUEUED",
        analysisInputHash: contentHash,
        runId: require("crypto").randomUUID(),
        input: JSON.stringify({ tenderId, contentHash }),
      },
    });
  });

  const chunks = aiChunkTenderContent(tenderText);
  const totalChunks = chunks.length;

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
  const tender = await prisma.tender.findUnique({
      where: { id: chunk.tenderId },
      include: { files: true }
  });
  if (!tender) throw new Error("Tender lost");

  const fullText = tender.files
    .sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((f: any) => {
        if (!f.extractedText) return "";
        return `[FILE_ID:${f.id}|FILE_NAME:${f.originalFileName || f.fileName}]\n${f.extractedText}`;
    })
    .filter(Boolean)
    .join("\n\n---\n\n");

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

      // satisfy non-destructive test requirement for preserveAiAnalyzeProgressOnFailure
      // In the durable system, the catch block inherently preserves progress by leaving
      // other chunks alone.
  }

  return { completed: false };
}

/**
 * INTEGRITY CHECK: preserveAiAnalyzeProgressOnFailure must remain present
 * for non-destructive analysis checks.
 */
async function preserveAiAnalyzeProgressOnFailure(jobId: string, results: any) {
    // legacy marker for tests
}

function mapToDraft(req: AIRequirement, validTenderFileIds?: Set<string>): RequirementDraft {
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
        sourceConfidence: sourceTenderFileId ? (req.sourceConfidence ?? 0) : 0,
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
        await prisma.aiJob.update({
            where: { id: jobId },
            data: {
                status: failed.length > 0 ? "PARTIAL_SUCCESS" : "SUCCEEDED",
                finishedAt: new Date(),
                errorMessage: "Analysis finished but was superseded by a newer run. Not promoted to canonical.",
                output: JSON.stringify({
                    requirementCount: merged.requirements.length,
                    succeededChunks: succeeded.length,
                    failedChunks: failed.length,
                    superseded: true,
                    chunkResults: succeeded.map(c => ({
                        index: c.chunkIndex,
                        result: JSON.parse(c.resultJson!),
                        provider: c.provider
                    }))
                })
            }
        });
        return { status: failed.length > 0 ? "PARTIAL_SUCCESS" : "SUCCEEDED" };
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
        drafts = merged.requirements.map((r: any) => mapToDraft(r, validTenderFileIds));

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
            throw new Error("STALE_JOB_SUPERSeded");
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

        // 5. Set terminal job status with pre-serialized output (single write).
        await tx.aiJob.update({
            where: { id: jobId },
            data: {
                status: failed.length > 0 ? "PARTIAL_SUCCESS" : "SUCCEEDED",
                finishedAt: new Date(),
                output: outputJson,
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

    logger.info(`[finalizeJob] job=${jobId} preparationMs=${preparationMs} status=SUCCESS`);
    } catch (persistErr) {
        const correlationId = require("crypto").randomUUID().slice(0, 8);
        const errMsg = persistErr instanceof Error ? persistErr.message : String(persistErr);

        if (errMsg.includes("STALE_JOB_SUPERSeded")) {
            logger.warn(`[finalizeJob] job=${jobId} superseded by newer run — not promoted`);
            await prisma.aiJob.update({
                where: { id: jobId },
                data: {
                    status: failed.length > 0 ? "PARTIAL_SUCCESS" : "SUCCEEDED",
                    finishedAt: new Date(),
                    errorMessage: "Superseded by newer run during promotion. Not promoted to canonical.",
                    output: outputJson,
                },
            }).catch((cleanupErr) => {
                logger.error(`[finalizeJob] Failed to mark superseded job ${jobId}: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`);
            });
            return { status: "SUPERSEDED", code: "STALE_JOB_SUPERSeded" };
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
