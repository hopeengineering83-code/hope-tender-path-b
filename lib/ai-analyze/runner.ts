import crypto from "crypto";
import { logger } from "../observability";
import { prisma } from "@/lib/prisma";
import {
  createAnalysisJob,
  runNextChunk,
  finalizeJob
} from "@/lib/ai-jobs/analysis-job-service";
import { resolveTenderAnalysisState } from "@/lib/engine/analysis-state-resolver";
import { formatTenderFileAnalysisMarker } from "@/lib/engine/requirement-source-linkage";
import { toSafeAiFailureCategory } from "@/lib/engine/analysis/safe-diagnostics";

/**
 * The single authoritative runner for AI Analysis.
 * All entry points (API routes, workers, recovery actions) MUST use this service
 * to ensure consistent state transitions and non-destructive behavior.
 */
export class AiAnalyzeRunner {
  /**
   * Start or resume an AI analysis job for a tender.
   */
  static async startOrResume(tenderId: string, userId: string, requestId?: string, force: boolean = false) {
    const tender = await prisma.tender.findUnique({
      where: { id: tenderId, userId },
      include: {
        files: {
          select: {
            id: true, fileName: true, originalFileName: true, classification: true, extractedText: true, createdAt: true
          }
        }
      }
    });

    if (!tender) throw new Error("Tender not found or access denied");

    // 1. Resolve current state to see if we have an active job
    const currentState = await resolveTenderAnalysisState(prisma, tenderId, userId);

    // 2. Generate content hash to check for changes
    const fileTexts = tender.files
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((f) => f.extractedText
        ? `${formatTenderFileAnalysisMarker(f)}\n${f.extractedText}`
        : `${formatTenderFileAnalysisMarker(f)} ${f.classification ?? ""}`)
      .join("\n\n");

    const contentHash = crypto.createHash("sha256").update(fileTexts).digest("hex");

    let jobId = currentState.latestJobId;

    // Check if existing job matches current content
    const existingJob = jobId ? await prisma.aiJob.findUnique({ where: { id: jobId } }) : null;
    const contentMismatch = existingJob && existingJob.analysisInputHash !== contentHash;

    if (!jobId || currentState.state === "NOT_STARTED" || currentState.state === "FAILED" || contentMismatch || force) {
      // Create a fresh job
      const job = await createAnalysisJob({ tenderId, userId });
      jobId = job.jobId;
    }

    // Reload state after potential job creation
    const finalState = await resolveTenderAnalysisState(prisma, tenderId, userId);

    return {
      jobId,
      status: finalState.state,
      totalChunks: finalState.totalChunks,
      completedChunks: finalState.completedChunks,
      failedChunks: finalState.totalChunks - finalState.completedChunks - (finalState.state === "RUNNING" ? 1 : 0),
      nextAction: finalState.resumable ? "RUN_NEXT_CHUNK" : (finalState.state === "RUNNING" ? "WAIT_FOR_CHUNKS" : "FINALIZE"),
    };
  }

  /**
   * Process the next available chunk for a job.
   * Atomic and transaction-safe via SKIP LOCKED.
   */
  static async runNextChunk(jobId: string, userId: string) {
    // Verify ownership
    const job = await prisma.aiJob.findUnique({ where: { id: jobId, userId } });
    if (!job) throw new Error("Job not found or access denied");

    try {
      return await runNextChunk(jobId, userId);
    } catch (error) {
      const category = toSafeAiFailureCategory(error);
      // We don't throw here to avoid 500ing the worker, but we log the safe category
      logger.error(`AI Chunk failed: ${category}`);
      throw error;
    }
  }

  /**
   * Finalize the job and promote results to canonical requirements.
   * Handles source grounding validation and version protection.
   */
  static async finalize(jobId: string, userId: string) {
    // Verify ownership
    const job = await prisma.aiJob.findUnique({ where: { id: jobId, userId } });
    if (!job) throw new Error("Job not found or access denied");

    return finalizeJob(jobId, userId);
  }
}
