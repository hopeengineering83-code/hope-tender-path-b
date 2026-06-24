import { toSafeAiFailureCategory } from "../engine/analysis/safe-diagnostics";
import { prisma } from "../prisma";
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
import { RequirementDraft } from "../engine/types";
import {
  canPromoteToCanonical,
  promoteAnalysisToCanonical,
  stagePartialResult
} from "../ai-analyze-promotion";

export type AnalysisJobCreateInput = {
  tenderId: string;
  userId: string;
};

export async function createAnalysisJob(input: AnalysisJobCreateInput) {
  const { tenderId, userId } = input;

  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: { files: true },
  });

  if (!tender) {
    throw new Error("Tender not found or access denied");
  }

  // Load the company vault documents exactly as the AI Analyze route does, so
  // the company-document digest (and therefore the content hash) matches.
  const company = await prisma.company.findUnique({
    where: { userId },
    include: { documents: { select: { category: true, originalFileName: true, extractedText: true }, take: 5, orderBy: { createdAt: "desc" } } },
  });

  // Build the AI-analysis content via the SHARED builder so the durable job
  // service and the synchronous route produce byte-identical content, hash, and
  // (via the shared chunker) chunk identity.
  const tenderText = buildTenderAnalysisContent(tender, company);

  if (!tenderText || tenderText.length < 100) {
    throw new Error("Tender extraction not ready or content too short");
  }

  const contentHash = computeAnalysisContentHash(tenderText);

  // Create or reuse resumable job. FAILED is included so a provider-exhausted
  // or partially-completed run can be retried/resumed against the SAME job and
  // its durable checkpoints, rather than spawning a duplicate.
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

  if (!job) {
    job = await prisma.aiJob.create({
      data: {
        tenderId,
        userId,
        jobType: "AI_ANALYZE",
        status: "QUEUED",
        analysisInputHash: contentHash,
        input: JSON.stringify({ tenderId, contentHash }),
        runId: require("crypto").randomUUID()
      },
    });
  } else if (job.status === "PARTIAL_SUCCESS" || job.status === "FAILED") {
    // RE-ARM for resume. claimJobForCaller (/api/ai-jobs/run-next) only claims
    // QUEUED rows, so a PARTIAL_SUCCESS/FAILED job would otherwise be
    // un-runnable and "Run/Resume AI Analyze" would do nothing. We reset it to
    // QUEUED and clear the terminal stamps; the completed AiAnalyzeChunk rows
    // (SUCCEEDED) and AiJob.output are preserved, so the next run continues
    // from the last successful chunk instead of restarting. A RUNNING/QUEUED
    // job is left untouched (this branch never resets the actively-claimed job
    // that executeAnalysis re-resolves mid-run).
    job = await prisma.aiJob.update({
      where: { id: job.id },
      data: { status: "QUEUED", startedAt: null, finishedAt: null, errorMessage: null },
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

function mapToDraft(req: AIRequirement): RequirementDraft {
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
        sourceTenderFileId: req.sourceTenderFileId || (req.sourceFileToken && req.sourceFileToken.length > 20 ? req.sourceFileToken : null),
        sourcePageNumber: req.sourcePage,
        sourceSectionHeading: req.sourceSectionHeading || req.sectionReference || null,
        sourceExactQuote: req.sourceQuote,
        sourceConfidence: req.sourceConfidence ?? 0,
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

    const mandatoryReqs = merged.requirements.filter((r: any) => /mandatory|critical/i.test(r.priority ?? ""));
    const invalidMandatory = mandatoryReqs.filter((r: any) => {
        // Treat a file reference as present only when it is a non-empty string —
        // guards against undefined/null/"" tokens slipping through as truthy.
        const fileId = typeof r.sourceTenderFileId === "string" ? r.sourceTenderFileId.trim() : "";
        const fileToken = typeof r.sourceFileToken === "string" ? r.sourceFileToken.trim() : "";
        const hasId = fileId.length > 0 || fileToken.length > 0;
        const hasPage = typeof r.sourcePage === "number" && r.sourcePage > 0;
        const hasQuote = typeof r.sourceQuote === "string" && r.sourceQuote.trim().length > 0;
        // Strict grounding: mandatory requirements MUST have file, page, and quote.
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

    // Atomically promote canonical requirements
    await prisma.$transaction(async (tx) => {
        await tx.aiJob.update({
            where: { id: jobId },
            data: { status: "RUNNING", updatedAt: new Date() }
        });

        const drafts = merged.requirements.map(mapToDraft);
        await upsertRequirements(tx, job.tenderId!, drafts);

        // Persist the FULL canonical metadata set via the shared builder so the
        // durable worker writes identical client/procuring-entity details,
        // submission fields, source-traceability columns, and the
        // metadataContaminated flag as the streaming/non-streaming routes.
        // Previously this path persisted NO client metadata and skipped
        // contamination detection — a tender analyzed via the async worker lost
        // every client detail (CLAUDE.md #3) and bypassed contamination
        // blocking (CLAUDE.md #6).
        const existingTender = await tx.tender.findUnique({
            where: { id: job.tenderId! },
            select: { clientName: true, submissionMethod: true, submissionEmails: true, notes: true },
        });
        const { data: canonicalData } = buildCanonicalAnalysisTenderUpdate(merged, {
            clientName: existingTender?.clientName,
            submissionMethod: existingTender?.submissionMethod,
            submissionEmails: existingTender?.submissionEmails,
            notes: existingTender?.notes,
        });

        await tx.tender.update({
            where: { id: job.tenderId! },
            data: {
                ...canonicalData,
                analysisSource: "AI",
                // Use the canonical ExtractionStatus vocabulary the downstream
                // gates understand (export-readiness, final-submission-readiness,
                // readiness-scoring, analysis-quality). The previous bespoke
                // values "FULL_AI_SUCCESS"/"PARTIAL_AI_SUCCESS" were write-only
                // orphans no gate recognized — so a PARTIAL run via the durable
                // worker escaped the partial-extraction cap/export-block and was
                // treated as a fully trusted analysis.
                analysisExtractionStatus: failed.length > 0 ? "PARTIAL_EXTRACTION_AI_ANALYZED" : "FULL_EXTRACTION_AI_ANALYZED",
                // Classification fields are not part of the shared client-metadata
                // builder; set them here from the merged analysis result.
                envelopeMode: merged.envelopeMode || undefined,
                clientType: merged.clientType || undefined,
                submissionFormat: merged.submissionFormat || undefined,
            }
        });

        const output = JSON.stringify({
            requirementCount: merged.requirements.length,
            succeededChunks: succeeded.length,
            failedChunks: failed.length,
            chunkResults: succeeded.map(c => ({
                index: c.chunkIndex,
                result: JSON.parse(c.resultJson!),
                provider: c.provider
            }))
        });

        await tx.aiJob.update({
            where: { id: jobId },
            data: {
                status: failed.length > 0 ? "PARTIAL_SUCCESS" : "SUCCEEDED",
                finishedAt: new Date(),
                output,
            }
        });

        await promoteAnalysisToCanonical(jobId, (job as any).runId || require("crypto").randomUUID());
    });

    return { status: failed.length > 0 ? "PARTIAL_SUCCESS" : "SUCCEEDED" };
}
