import { prisma } from "../prisma";
import { createHash } from "crypto";
import {
  analyzeWithAI,
  isProviderExhaustedError,
  mergeAnalysisResults,
  type AIAnalysisResult,
  type AIRequirement
} from "../ai";
import { upsertRequirements } from "../engine/stable-requirements";
import { RequirementDraft } from "../engine/types";

export type AnalysisJobCreateInput = {
  tenderId: string;
  userId: string;
};

export function chunkTenderContent(text: string): string[] {
  const CHUNK_SIZE = 80_000;
  const overlap = 2_000;
  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    const end = Math.min(offset + CHUNK_SIZE, text.length);
    chunks.push(text.slice(offset, end));
    if (end === text.length) break;
    offset += CHUNK_SIZE - overlap;
  }
  return chunks;
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

  const tenderText = tender.files
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((f) => f.extractedText)
    .filter(Boolean)
    .join("\n\n---\n\n");

  if (!tenderText || tenderText.length < 100) {
    throw new Error("Tender extraction not ready or content too short");
  }

  const contentHash = createHash("sha256").update(tenderText).digest("hex");

  // Create or reuse resumable job
  let job = await prisma.aiJob.findFirst({
    where: {
      tenderId,
      userId,
      jobType: "AI_ANALYZE",
      analysisInputHash: contentHash,
      status: { in: ["QUEUED", "RUNNING", "PARTIAL_SUCCESS"] },
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
      },
    });
  }

  const chunks = chunkTenderContent(tenderText);
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
    .map((f: any) => f.extractedText)
    .filter(Boolean)
    .join("\n\n---\n\n");

  try {
      const aiResult = await analyzeWithAI(fullText, {
          startFromChunk: chunk.chunkIndex,
          previousChunkResults: [],
          deadlineAt: Date.now() + 60_000,
      });

      const specificResult = aiResult.chunkResults.find(r => r.index === chunk.chunkIndex);

      if (specificResult) {
          await prisma.aiAnalyzeChunk.update({
              where: { id: chunk.id },
              data: {
                  status: "SUCCEEDED",
                  finishedAt: new Date(),
                  provider: specificResult.provider,
                  resultJson: JSON.stringify(specificResult.result)
              }
          });
      } else {
          throw new Error("Chunk result missing after AI call");
      }
  } catch (err) {
      const isExhausted = isProviderExhaustedError(err);
      const category = isExhausted ? "PROVIDER_EXHAUSTED" : "TRANSIENT_ERROR";
      const safeError = err instanceof Error ? err.message.slice(0, 500) : "Unknown error";

      await prisma.aiAnalyzeChunk.update({
          where: { id: chunk.id },
          data: {
              status: "FAILED",
              finishedAt: new Date(),
              failureCategory: category,
              errorMessage: safeError
          }
      });
  }

  return { completed: false };
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
        sourceTenderFileId: req.sourceTenderFileId,
        sourcePageNumber: req.sourcePage,
        sourceSectionHeading: req.sourceSectionHeading,
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
        return !r.sourceTenderFileId || !r.sourcePage || !r.sourceQuote || (r.sourceConfidence ?? 0) < 0.5;
    });

    if (invalidMandatory.length > 0) {
        await prisma.aiJob.update({
            where: { id: jobId },
            data: {
                status: "FAILED",
                finishedAt: new Date(),
                errorMessage: `Rejected: ${invalidMandatory.length} mandatory requirements have weak sourcing.`
            }
        });
        return { status: "FAILED", reason: "WEAK_SOURCING" };
    }

    // Atomically promote canonical requirements
    await prisma.$transaction(async (tx) => {
        // Ensure the job status remains RUNNING during the requirements promotion
        // so the database trigger guard_canonical_requirement_set_delete doesn't block it.
        await tx.aiJob.update({
            where: { id: jobId },
            data: { status: "RUNNING", updatedAt: new Date() }
        });

        const drafts = merged.requirements.map(mapToDraft);
        await upsertRequirements(tx, job.tenderId!, drafts);

        await tx.tender.update({
            where: { id: job.tenderId! },
            data: {
                analysisSource: "AI",
                analysisExtractionStatus: failed.length > 0 ? "PARTIAL_AI_SUCCESS" : "FULL_AI_SUCCESS",
                title: merged.tenderTitle || undefined,
                category: merged.tenderCategory || undefined,
                envelopeMode: merged.envelopeMode || undefined,
                clientType: merged.clientType || undefined,
                submissionFormat: merged.submissionFormat || undefined,
            }
        });

        await tx.aiJob.update({
            where: { id: jobId },
            data: {
                status: failed.length > 0 ? "PARTIAL_SUCCESS" : "SUCCEEDED",
                finishedAt: new Date(),
                output: JSON.stringify({
                    requirementCount: merged.requirements.length,
                    succeededChunks: succeeded.length,
                    failedChunks: failed.length
                }),
                promotedAt: new Date(),
                promotedBy: userId
            }
        });
    });

    return { status: failed.length > 0 ? "PARTIAL_SUCCESS" : "SUCCEEDED" };
}
