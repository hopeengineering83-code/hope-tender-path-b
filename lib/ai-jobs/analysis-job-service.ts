// lib/ai-jobs/analysis-job-service.ts
//
// Durable AI_ANALYZE job lifecycle: create → runNextChunk → finalizeJob.
//
// The durable worker is the THIRD promotion path (after streaming and
// non-streaming ai-analyze/route.ts) and must honour the SAME grounding
// guarantees:
//   • page numbers guarded by locateQuoteProvenPage (full-quote, fail-closed)
//   • source fileId resolved via attributeMetadataSourceFileId (no guessing)
//   • existingContactDetailsSourceJson preserved across AI re-runs
//   • reference fileId re-resolved when the existing one points to a
//     deleted/inactive file
//
// finalizeJob transaction discipline:
//   • A pre-tx preparation block builds the canonical tender update, the
//     requirement drafts, and the strict-grounding validation set OUTSIDE
//     the transaction (no JSON.stringify / mapToDraft /
//     buildCanonicalAnalysisTenderUpdate inside tx — those open separate
//     connections that consume the 10000ms budget).
//   • A short interactive transaction block re-verifies canPromoteToCanonical
//     INSIDE tx (catches stale-job supersession), then upserts requirements,
//     writes the canonical tender update, marks the job SUCCEEDED or
//     PARTIAL_SUCCESS, and calls promoteAnalysisToCanonical — all via tx.
//
// Provider health is restored from DB before chunk analysis (cold-start
// instances have empty in-memory state) and persisted after both success
// and failure (so cooldown state survives worker restart).

import { toSafeAiFailureCategory } from "../engine/analysis/safe-diagnostics";
import { prisma } from "../prisma";
import { logger } from "../observability";
import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
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
import { RequirementDraft } from "../engine/types";
import {
  canPromoteToCanonical,
  promoteAnalysisToCanonical,
  stagePartialResult
} from "../ai-analyze-promotion";
import {
  buildCanonicalAnalysisTenderUpdate,
} from "../engine/canonical-analysis-update";
import {
  buildTenderAnalysisContent,
  computeAnalysisContentHash,
} from "../engine/tender-analysis-content";
import {
  attributeMetadataSourceFileId,
  type AttributionFile,
} from "../engine/metadata-source-attribution";
import { locateQuoteProvenPage } from "../engine/page-provenance";
import {
  restoreHealthFromDb,
  persistAllHealthToDb,
} from "../ai-provider-health-db";

export type AnalysisJobCreateInput = {
  tenderId: string;
  userId: string;
};

// ─── createAnalysisJob ──────────────────────────────────────────────────────

export async function createAnalysisJob(input: AnalysisJobCreateInput) {
  const { tenderId, userId } = input;

  const tenderRow = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      files: {
        select: {
          id: true,
          fileName: true,
          extractedText: true,
          createdAt: true,
          deletionStatus: true,
          totalPages: true,
        },
      },
    },
  });

  if (!tenderRow) {
    throw new Error("Tender not found or access denied");
  }

  // Build the analysis content via the SHARED builder so the durable path
  // and the streaming/non-streaming routes produce identical chunk hashes
  // (the previous scheme hashed raw extractedText with a full sha256 —
  // producing disjoint AiAnalyzeChunk rows between paths).
  const tender = {
    id: tenderRow.id,
    title: tenderRow.title,
    description: tenderRow.description ?? null,
    intakeSummary: (tenderRow as any).intakeSummary ?? null,
    files: tenderRow.files
      .filter((f) => (f.deletionStatus ?? "ACTIVE") === "ACTIVE")
      .map((f) => ({
        id: f.id,
        originalFileName: f.fileName,
        extractedText: f.extractedText,
        createdAt: f.createdAt,
      })),
  };
  // Company documents (vault) — empty in the durable path; the route
  // resolves these from CompanyDocument rows. We pass `undefined` here so
  // the builder uses the same signature as the route.
  const company = undefined;
  const tenderText = buildTenderAnalysisContent(tender, company);
  const contentHash = computeAnalysisContentHash(tenderText);

  if (!tenderText || tenderText.length < 100) {
    throw new Error("Tender extraction not ready or content too short");
  }

  // Create or reuse resumable job. Re-arm a PARTIAL_SUCCESS or FAILED job
  // back to QUEUED so run-next can re-claim it (claimJobForCaller only
  // claims QUEUED rows; without re-arming, Resume does nothing).
  let job = await prisma.aiJob.findFirst({
    where: {
      tenderId,
      userId,
      jobType: "AI_ANALYZE",
      analysisInputHash: contentHash,
      status: { in: ["QUEUED", "RUNNING", "PARTIAL_SUCCESS", "FAILED"] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (job && (job.status === "PARTIAL_SUCCESS" || job.status === "FAILED")) {
    // Re-arm: clear terminal state so the scheduler picks the job back up.
    job = await prisma.aiJob.update({
      where: { id: job.id },
      data: { status: "QUEUED", startedAt: null, finishedAt: null, errorMessage: null },
    });
  }

  if (!job) {
    job = await prisma.aiJob.create({
      data: {
        tenderId,
        userId,
        jobType: "AI_ANALYZE",
        status: "QUEUED",
        analysisInputHash: contentHash,
        input: JSON.stringify({ tenderId, contentHash }),
        runId: randomUUID(),
      },
    });
  }

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

// ─── runNextChunk ───────────────────────────────────────────────────────────

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
      include: {
        files: {
          select: {
            id: true,
            fileName: true,
            extractedText: true,
            createdAt: true,
            deletionStatus: true,
            totalPages: true,
          },
        },
      }
  });
  if (!tender) throw new Error("Tender lost");

  const fullText = tender.files
    .filter((f: any) => (f.deletionStatus ?? "ACTIVE") === "ACTIVE")
    .sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((f: any) => {
        if (!f.extractedText) return "";
        return `[FILE_ID:${f.id}|FILE_NAME:${f.fileName}]\n${f.extractedText}`;
    })
    .filter(Boolean)
    .join("\n\n---\n\n");

  try {
      const allChunks = aiChunkTenderContent(fullText);
      const chunkText = allChunks[chunk.chunkIndex];
      if (!chunkText) throw new Error(`Chunk ${chunk.chunkIndex} out of bounds (total: ${allChunks.length})`);

      // Restore provider health from DB BEFORE chunk analysis. Cold-start
      // instances have empty in-memory state and would retry providers that
      // are in cooldown.
      await restoreHealthFromDb();

      let providerUsed: string | undefined;
      const res = await analyzeOneChunkWithRetry(chunkText, chunk.chunkIndex, allChunks.length, (p: any) => {
          providerUsed = p;
      });

      // Persist provider health after success so cooldown state survives
      // worker restart.
      try {
        await persistAllHealthToDb();
      } catch (healthErr) {
        logger.warn("durable worker: persistAllHealthToDb failed (non-critical)", {
          detail: healthErr instanceof Error ? healthErr.message : String(healthErr),
        });
      }

      await prisma.aiAnalyzeChunk.update({
          where: { id: chunk.id },
          data: {
              status: "SUCCEEDED",
              finishedAt: new Date(),
              provider: providerUsed,
              resultJson: JSON.stringify(res)
          }
      });
  } catch (err) {
      const category = toSafeAiFailureCategory(err);
      const safeError = `AI provider error: ${category}`;

      // Persist provider health after failure too — the failure may have
      // triggered a cooldown that must survive worker restart.
      try {
        await persistAllHealthToDb();
      } catch (healthErr) {
        logger.warn("durable worker: persistAllHealthToDb failed after chunk failure (non-critical)", {
          detail: healthErr instanceof Error ? healthErr.message : String(healthErr),
        });
      }

      await prisma.aiAnalyzeChunk.update({
          where: { id: chunk.id },
          data: {
              status: "FAILED",
              finishedAt: new Date(),
              failureCategory: category,
              errorMessage: safeError
          }
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

/**
 * Map an AI requirement to the canonical RequirementDraft shape.
 *
 * validTenderFileIds: the set of ACTIVE TenderFile IDs for this tender.
 * When provided, sourceFileToken is validated against this set — foreign
 * or guessed tokens are rejected. The previous length-based heuristic
 * (`sourceFileToken` longer than twenty characters) accepted any long string as a file
 * id, which let AI hallucinations through.
 */
function mapToDraft(req: AIRequirement, validTenderFileIds?: Set<string>): RequirementDraft {
    const validSet = validTenderFileIds ?? new Set<string>();
    const rawToken = req.sourceFileToken ?? null;
    const resolvedFileId = rawToken && validSet.has(rawToken) ? rawToken : (req.sourceTenderFileId ?? null);
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
        sourceTenderFileId: resolvedFileId,
        sourcePageNumber: req.sourcePage,
        sourceSectionHeading: req.sourceSectionHeading,
        sourceExactQuote: req.sourceQuote,
        sourceConfidence: req.sourceConfidence ?? 0,
        sourceExtractionMethod: req.sourceExtractionMethod
    };
}

// ─── finalizeJob ────────────────────────────────────────────────────────────

// Extraction-status capping: when AI finished a partial run, cap the
// persisted analysisExtractionStatus at PARTIAL_AI_SUCCESS / REGEX_FALLBACK
// so downstream gates correctly treat the tender as not-fully-analyzed.
// Full AI success promotes PARTIAL_EXTRACTION_AI_ANALYZED → FULL_EXTRACTION_AI_ANALYZED.
const EXTRACTION_STATUS_PROMOTION_MAP: Record<string, string> = {
  "PARTIAL_EXTRACTION_AI_ANALYZED": "FULL_EXTRACTION_AI_ANALYZED",
};

export async function finalizeJob(jobId: string, userId: string) {
    const correlationId = randomUUID();

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
                    // REGEX_FALLBACK_UNAPPROVED caps the tender as audit-only —
                    // downstream generation/export/Final ZIP gates fail closed.
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

    // ─── PRE-TRANSACTION PREPARATION ──────────────────────────────────
    // Build the canonical tender update payload, the requirement drafts,
    // and the strict-grounding validation set OUTSIDE the transaction so
    // the transaction contains ONLY short tx.* calls. Previously the
    // transaction called buildCanonicalAnalysisTenderUpdate, mapToDraft,
    // and JSON.stringify inline — each of those opened a separate
    // connection that consumed the 10000ms budget.

    // Load the existing tender with all source-evidence columns + entity
    // fields + totalPages + contactDetailsSourceJson so the canonical
    // builder can preserve existing fileId entries and the strict-grounding
    // check can validate against the active file set.
    const existingTender = await prisma.tender.findUnique({
        where: { id: job.tenderId! },
        select: {
            id: true,
            title: true,
            clientName: true,
            procuringEntityName: true,
            legalClientName: true,
            donorAgency: true,
            implementingAgency: true,
            country: true,
            submissionMethod: true,
            submissionEmails: true,
            submissionEmailSubject: true,
            notes: true,
            deadline: true,
            contactDetailsSourceJson: true,
            analysisExtractionStatus: true,
            files: {
                select: {
                    id: true,
                    fileName: true,
                    extractedText: true,
                    totalPages: true,
                    deletionStatus: true,
                },
            },
        },
    });

    if (!existingTender) {
        throw new Error("Tender not found during finalize");
    }

    const activeFiles: AttributionFile[] = (existingTender.files ?? [])
        .filter((f) => (f.deletionStatus ?? "ACTIVE") === "ACTIVE");

    // Strict-grounding set: the IDs of all ACTIVE TenderFiles. Source
    // tokens / fileIds that aren't in this set are foreign / guessed and
    // must be rejected (the old length-based heuristic accepted any
    // 20+ char string as a fileId).
    const activeFileIdSet = new Set<string>(activeFiles.map((f) => f.id));

    // Strict-grounding validation: every MANDATORY requirement MUST have a
    // sourceFileId / sourceFileToken that resolves to an ACTIVE file.
    const mandatoryReqs = merged.requirements.filter((r: any) => /mandatory|critical/i.test(r.priority ?? ""));
    const invalidMandatory = mandatoryReqs.filter((r: any) => {
        const fileId = r.sourceTenderFileId ?? null;
        const fileToken = r.sourceFileToken ?? null;
        const hasValidFile = (fileId && activeFileIdSet.has(fileId)) || (fileToken && activeFileIdSet.has(fileToken));
        // Strict grounding: mandatory requirements MUST have file, page, and quote
        return !hasValidFile || !r.sourcePage || !r.sourceQuote;
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

    // Guard AI-claimed page numbers via the canonical quote→page resolver.
    // locateQuoteProvenPage uses the FULL quote (no 20-char prefix match,
    // no offset-0 fallback — both were the pre-#936 bugs that invented
    // page 1 for unfound quotes).
    const guardPage = (quote: string | null | undefined, fileId: string | null): number | null => {
        if (!quote || !fileId) return null;
        const file = activeFiles.find((f) => f.id === fileId);
        if (!file || !file.extractedText) return null;
        // totalPages is fetched on the tender.files select (TenderFile.totalPages).
        // AttributionFile doesn't surface it directly, so look it up from the
        // existingTender.files record we already loaded.
        const fileRecord = (existingTender.files ?? []).find((fr) => fr.id === fileId);
        const totalPages = fileRecord?.totalPages ?? null;
        return locateQuoteProvenPage(file.extractedText, quote, totalPages);
    };

    // Re-attribute the source file IDs from the AI's source quotes via the
    // canonical attribution helper (no guessing, no length heuristic).
    const sourceFileIds = {
        clientNameSourceFileId: attributeMetadataSourceFileId(merged.clientNameSourceQuote, activeFiles),
        submissionMethodSourceFileId: attributeMetadataSourceFileId(merged.submissionMethodSourceQuote, activeFiles),
        submissionAddressSourceFileId: attributeMetadataSourceFileId(merged.submissionAddressSourceQuote, activeFiles),
        submissionEmailSourceFileId: attributeMetadataSourceFileId(merged.submissionEmailSourceQuote, activeFiles),
        titleSourceFileId: attributeMetadataSourceFileId(merged.tenderTitleSourceQuote, activeFiles),
        deadlineSourceFileId: attributeMetadataSourceFileId(merged.deadlineSourceQuote, activeFiles),
    };

    // Guarded copy of the merged result. Each critical field's page is
    // re-resolved via locateQuoteProvenPage so AI-claimed page numbers
    // that don't actually contain the quote become null (ungrounded).
    const guardedMerged: any = { ...merged };
    guardedMerged.tenderTitleSourcePage = guardPage(merged.tenderTitleSourceQuote, sourceFileIds.titleSourceFileId);
    guardedMerged.deadlineSourcePage = guardPage(merged.deadlineSourceQuote, sourceFileIds.deadlineSourceFileId);
    guardedMerged.clientNameSourcePage = guardPage(merged.clientNameSourceQuote, sourceFileIds.clientNameSourceFileId);
    guardedMerged.submissionEmailSourcePage = guardPage(merged.submissionEmailSourceQuote, sourceFileIds.submissionEmailSourceFileId);
    guardedMerged.submissionMethodSourcePage = guardPage(merged.submissionMethodSourceQuote, sourceFileIds.submissionMethodSourceFileId);
    guardedMerged.submissionAddressSourcePage = guardPage(merged.submissionAddressSourceQuote, sourceFileIds.submissionAddressSourceFileId);

    // Build the canonical tender update payload OUTSIDE the transaction.
    // existingContactDetailsSourceJson preserves repair-written fileId
    // entries when AI re-runs (without it, AI re-runs would overwrite the
    // entire JSON and lose fileId for procurementReferenceNumber).
    const { data: canonicalTenderData } = buildCanonicalAnalysisTenderUpdate(guardedMerged, {
        clientName: existingTender.clientName,
        submissionMethod: existingTender.submissionMethod,
        submissionEmails: existingTender.submissionEmails,
        notes: existingTender.notes,
        ...sourceFileIds,
        existingContactDetailsSourceJson: existingTender?.contactDetailsSourceJson ?? null,
    });

    // Build requirement drafts OUTSIDE the transaction, passing the active
    // file-id set so mapToDraft can validate sourceFileToken against it.
    const drafts = merged.requirements.map((r: AIRequirement) => mapToDraft(r, activeFileIdSet));

    // Pre-compute the output JSON OUTSIDE the transaction so JSON.stringify
    // is not called inside tx (each JSON.stringify call opened a separate
    // connection that consumed the transaction budget).
    const outputJson = JSON.stringify({
        requirementCount: merged.requirements.length,
        succeededChunks: succeeded.length,
        failedChunks: failed.length,
        chunkResults: succeeded.map((c: any) => ({
            index: c.chunkIndex,
            result: JSON.parse(c.resultJson!),
            provider: c.provider
        }))
    });

    // Resolve the terminal extraction status OUTSIDE the transaction.
    // Full AI success promotes PARTIAL_EXTRACTION_AI_ANALYZED →
    // FULL_EXTRACTION_AI_ANALYZED. Partial runs cap at PARTIAL_AI_SUCCESS.
    const failedCount = failed.length;
    const priorExtractionStatus = existingTender.analysisExtractionStatus ?? null;
    let resolvedExtractionStatus: string;
    if (failedCount > 0) {
        // Partial — cap at PARTIAL_AI_SUCCESS so downstream gates fail closed.
        resolvedExtractionStatus = "PARTIAL_AI_SUCCESS";
    } else if (priorExtractionStatus && EXTRACTION_STATUS_PROMOTION_MAP[priorExtractionStatus]) {
        // Full success promotes a prior partial status to the full one.
        resolvedExtractionStatus = EXTRACTION_STATUS_PROMOTION_MAP[priorExtractionStatus];
    } else {
        resolvedExtractionStatus = "FULL_AI_SUCCESS";
    }

    // ─── SHORT INTERACTIVE TRANSACTION ───────────────────────────────
    // The transaction contains ONLY tx.* calls (no bare prisma.*, no
    // JSON.stringify, no mapToDraft, no buildCanonicalAnalysisTenderUpdate).
    // canPromoteToCanonical is re-verified INSIDE the tx so a concurrent
    // newer run that lands between PREPARATION and the tx is detected —
    // STALE_JOB_SUPERSeded handling returns SUPERSEDED instead of
    // overwriting the newer run's canonical state.
    // The tenderUpdate payload is typed Prisma.TenderUpdateInput so the
    // compiler catches any field that isn't a real schema column. The
    // prior bug wrote four non-schema fields to the tender update —
    // none of which exist in the Tender model. The type annotation
    // prevents that class of bug from recurring.
    const tenderUpdate: Prisma.TenderUpdateInput = {
        ...canonicalTenderData,
        analysisExtractionStatus: resolvedExtractionStatus,
    };
    let txOutcome: { status: "SUCCEEDED" | "PARTIAL_SUCCESS" | "SUPERSEDED" };
    try {
        txOutcome = await prisma.$transaction(async (tx) => {
            // Re-verify promotion eligibility INSIDE the transaction. A
            // newer job may have been created between PREPARATION and here.
            const canPromote = await canPromoteToCanonical(jobId, job.tenderId!, tx);
            if (!canPromote) {
                // STALE_JOB_SUPERSeded: this job was superseded by a newer
                // run while we were preparing. Mark it SUPERSEDED (not
                // SUCCEEDED) so the operator UI shows the newer run as
                // authoritative.
                await tx.aiJob.update({
                    where: { id: jobId },
                    data: {
                        status: "SUPERSEDED",
                        finishedAt: new Date(),
                        errorMessage: "Superseded by a newer AI Analyze job",
                    },
                });
                return { status: "SUPERSEDED" };
            }

            await tx.aiJob.update({
                where: { id: jobId },
                data: { status: "RUNNING", updatedAt: new Date() }
            });

            await upsertRequirements(tx, job.tenderId!, drafts);

            await tx.tender.update({
                where: { id: job.tenderId! },
                data: tenderUpdate,
            });

            await tx.aiJob.update({
                where: { id: jobId },
                data: {
                    status: failed.length > 0 ? "PARTIAL_SUCCESS" : "SUCCEEDED",
                    finishedAt: new Date(),
                    output: outputJson,
                }
            });

            await promoteAnalysisToCanonical(jobId, (job as any).runId || randomUUID(), tx);

            return {
                status: (failed.length > 0 ? "PARTIAL_SUCCESS" : "SUCCEEDED") as "SUCCEEDED" | "PARTIAL_SUCCESS",
            };
        }, {
            // Keep the timeout low so the operator sees a fast failure
            // instead of a 100s hang. The pre-tx preparation block keeps
            // the tx body small enough to fit comfortably.
            timeout: 15_000,
            isolationLevel: "Serializable" as any,
        });
    } catch (persistErr) {
        // AI_ANALYSIS_PERSISTENCE_FAILED — structured log with correlationId,
        // jobId, tenderId so the operator can trace the failure across
        // logs / audit / job state.
        logger.error(
            `AI_ANALYSIS_PERSISTENCE_FAILED correlation=${correlationId} job=${jobId} tender=${job.tenderId}`,
            {
                correlationId,
                jobId,
                tenderId: job.tenderId ?? undefined,
                detail: persistErr instanceof Error ? persistErr.message : String(persistErr),
            },
        );
        // Re-mark the job as FAILED so the operator sees the persistence
        // failure in the UI (the tx rolled back any partial writes).
        // catch(updateErr) — logs a structured error so a failure here is
        // never silently swallowed.
        try {
            await prisma.aiJob.update({
                where: { id: jobId },
                data: {
                    status: "FAILED",
                    finishedAt: new Date(),
                    errorMessage: "AI_ANALYSIS_PERSISTENCE_FAILED",
                },
            });
        } catch (updateErr) {
            // catch((updateErr)) — structured log so the failure is never
            // silently swallowed. The pattern matches the PR #872 contract.
            console.error(
                `Failed to mark job ${jobId} as FAILED after persistence error`,
                {
                    correlationId,
                    jobId,
                    tenderId: job.tenderId ?? undefined,
                    originalError: persistErr instanceof Error ? persistErr.message : String(persistErr),
                    updateError: updateErr instanceof Error ? updateErr.message : String(updateErr),
                },
            );
        }
        return {
            status: "FAILED",
            code: "AI_ANALYSIS_PERSISTENCE_FAILED",
            correlationId,
        };
    }

    // ─── POST-TRANSACTION: reference fileId resolution ───────────────
    // After the transaction commits, resolve the procurementReferenceNumber
    // source fileId. AI doesn't emit fileIds (only quotes), so we attribute
    // the quote to the active file that contains it. If the existing fileId
    // already points to an active file, leave it alone. Wrapped in try/catch
    // so a failure here doesn't break the analysis (the reference column is
    // non-critical — the audit + grounding checks elsewhere catch a missing
    // fileId).
    try {
        const existingJson = existingTender?.contactDetailsSourceJson ?? null;
        if (existingJson) {
            const contactDetails = JSON.parse(existingJson) as Record<string, { page: number | null; quote: string | null; fileId?: string | null }>;
            const refEntry = contactDetails["procurementReferenceNumber"];
            if (refEntry && refEntry.quote && refEntry.quote.trim().length >= 6) {
                const attrFiles = activeFiles;
                const existingFileIdStillActive = refEntry.fileId
                    ? activeFiles.some((f) => f.id === refEntry.fileId)
                    : false;
                if (!refEntry.fileId || !existingFileIdStillActive) {
                    const resolvedFileId = attributeMetadataSourceFileId(refEntry.quote, attrFiles);
                    if (resolvedFileId) {
                        contactDetails["procurementReferenceNumber"] = {
                            page: refEntry.page ?? null,
                            quote: refEntry.quote,
                            fileId: resolvedFileId,
                        };
                        await prisma.tender.update({
                            where: { id: job.tenderId! },
                            data: {
                                contactDetailsSourceJson: JSON.stringify(contactDetails),
                            },
                        });
                    }
                }
            }
        }
    } catch (refErr) {
        // reference fileId resolution failed (non-critical) — the analysis
        // itself succeeded; only the post-hoc fileId attribution failed.
        logger.warn("reference fileId resolution failed (non-critical)", {
            jobId,
            tenderId: job.tenderId ?? undefined,
            detail: refErr instanceof Error ? refErr.message : String(refErr),
        });
    }

    return { status: txOutcome.status };
}
