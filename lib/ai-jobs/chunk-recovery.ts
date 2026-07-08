// AI job chunk recovery helpers.
//
// CHUNKS_STILL_ACTIVE must never be a permanent final state. This module
// provides the logic to:
//   • Detect fresh vs stale RUNNING/QUEUED chunks
//   • Reset stale chunks back to QUEUED (so run-next can re-claim them)
//   • Finalize completed chunks (force-terminal any lingering RUNNING chunks
//     that have a result, then promote the job)
//   • Restart the entire job (mark all chunks QUEUED, reset job to RUNNING)
//
// All operations are tenant-safe (scoped to userId), idempotent, and audited
// via AiJobStep rows.

import { prisma, prismaReady } from "../prisma";
import { logAction } from "../audit";
import { randomUUID } from "node:crypto";

// A chunk is "stale" if it has been RUNNING longer than this threshold.
// Default: 10 minutes. Fresh chunks (below threshold) are still genuinely
// running and should NOT be reset.
const STALE_CHUNK_THRESHOLD_MS = 10 * 60 * 1000;

export type ChunkRecoveryDiagnostics = {
  jobId: string;
  tenderId: string | null;
  userId: string;
  totalChunks: number;
  queuedCount: number;
  runningCount: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
  staleRunningCount: number;
  freshRunningCount: number;
  promotionStatus: string;
  promotionCode: string | null;
  recoverable: boolean;
  recoverActions: string[];
  /** ISO timestamps for structured logging */
  oldestRunningStartedAt: string | null;
  newestChunkUpdatedAt: string | null;
};

export type ChunkRecoveryAction =
  | "resume"
  | "finalize_completed"
  | "reset_stale"
  | "restart";

export type ChunkRecoveryResult = {
  ok: boolean;
  action: ChunkRecoveryAction;
  jobId: string;
  message: string;
  diagnostics: ChunkRecoveryDiagnostics;
  /** Number of chunks affected by the recovery action */
  affectedChunks: number;
};

/**
 * Compute diagnostics for an AI job's chunks. Classifies RUNNING chunks as
 * fresh or stale based on the STALE_CHUNK_THRESHOLD_MS threshold.
 */
export async function diagnoseJobChunks(
  jobId: string,
  userId: string,
): Promise<ChunkRecoveryDiagnostics | null> {
  await prismaReady;
  const job = await prisma.aiJob.findFirst({
    where: { id: jobId, userId },
    include: { analyzeChunks: true },
  });
  if (!job) return null;

  const allChunks = job.analyzeChunks;
  const succeeded = allChunks.filter((c: any) => c.status === "SUCCEEDED");
  const failed = allChunks.filter((c: any) => c.status === "FAILED");
  const skipped = allChunks.filter((c: any) => c.status === "SKIPPED");
  const queued = allChunks.filter((c: any) => c.status === "QUEUED");
  const running = allChunks.filter((c: any) => c.status === "RUNNING");

  const now = Date.now();
  const staleThreshold = new Date(now - STALE_CHUNK_THRESHOLD_MS);
  const staleRunning = running.filter((c: any) => c.startedAt && c.startedAt < staleThreshold);
  const freshRunning = running.filter((c: any) => !c.startedAt || c.startedAt >= staleThreshold);

  const recoverActions: string[] = [];
  if (queued.length > 0 || freshRunning.length > 0) {
    recoverActions.push("resume");
  }
  if (succeeded.length > 0 && running.length === 0 && queued.length === 0) {
    recoverActions.push("finalize_completed");
  }
  if (staleRunning.length > 0) {
    recoverActions.push("reset_stale");
  }
  if (failed.length === allChunks.length && allChunks.length > 0) {
    recoverActions.push("restart");
  }

  const oldestRunning = running
    .map((c: any) => c.startedAt)
    .filter((d: any): d is Date => !!d)
    .sort((a: any, b: any) => a.getTime() - b.getTime())[0];
  const newestUpdated = allChunks
    .map((c: any) => c.updatedAt)
    .sort((a: any, b: any) => b.getTime() - a.getTime())[0];

  // Determine promotion status
  let promotionStatus = "UNKNOWN";
  let promotionCode: string | null = null;
  if (job.status === "SUCCEEDED") {
    promotionStatus = "PROMOTED";
  } else if (job.status === "FAILED") {
    promotionStatus = "FAILED";
    promotionCode = "AI_CHUNKS_FAILED";
  } else if (running.length > 0 || queued.length > 0) {
    promotionStatus = "CHUNKS_STILL_ACTIVE";
    promotionCode = "CHUNKS_STILL_ACTIVE";
    if (staleRunning.length > 0) {
      promotionStatus = "CHUNKS_STALE";
    }
  } else if (succeeded.length > 0) {
    promotionStatus = "READY_TO_FINALIZE";
  }

  return {
    jobId,
    tenderId: job.tenderId,
    userId,
    totalChunks: allChunks.length,
    queuedCount: queued.length,
    runningCount: running.length,
    succeededCount: succeeded.length,
    failedCount: failed.length,
    skippedCount: skipped.length,
    staleRunningCount: staleRunning.length,
    freshRunningCount: freshRunning.length,
    promotionStatus,
    promotionCode,
    recoverable: recoverActions.length > 0,
    recoverActions,
    oldestRunningStartedAt: oldestRunning ? oldestRunning.toISOString() : null,
    newestChunkUpdatedAt: newestUpdated ? newestUpdated.toISOString() : null,
  };
}

/**
 * Reset stale RUNNING chunks back to QUEUED so run-next can re-claim them.
 * Only resets chunks that have been RUNNING longer than the stale threshold.
 * Fresh RUNNING chunks are left alone (they're genuinely still processing).
 */
export async function resetStaleChunks(jobId: string, userId: string): Promise<ChunkRecoveryResult> {
  const diagnostics = await diagnoseJobChunks(jobId, userId);
  if (!diagnostics) {
    return {
      ok: false,
      action: "reset_stale",
      jobId,
      message: "Job not found",
      diagnostics: emptyDiagnostics(jobId, userId),
      affectedChunks: 0,
    };
  }
  if (diagnostics.staleRunningCount === 0) {
    return {
      ok: true,
      action: "reset_stale",
      jobId,
      message: "No stale RUNNING chunks to reset",
      diagnostics,
      affectedChunks: 0,
    };
  }

  await prismaReady;
  const staleThreshold = new Date(Date.now() - STALE_CHUNK_THRESHOLD_MS);
  const result = await prisma.aiAnalyzeChunk.updateMany({
    where: {
      jobId,
      status: "RUNNING",
      startedAt: { lt: staleThreshold },
    },
    data: {
      status: "QUEUED",
      startedAt: null,
      errorMessage: "Reset by stale-chunk recovery",
    },
  });

  await auditRecovery(jobId, userId, "reset_stale", result.count);

  const updatedDiagnostics = await diagnoseJobChunks(jobId, userId);
  return {
    ok: true,
    action: "reset_stale",
    jobId,
    message: `Reset ${result.count} stale RUNNING chunk(s) back to QUEUED. Run-next will re-claim them.`,
    diagnostics: updatedDiagnostics ?? diagnostics,
    affectedChunks: result.count,
  };
}

/**
 * Finalize completed chunks. If all chunks are terminal (SUCCEEDED/FAILED/SKIPPED),
 * this triggers the job's finalization path. If some chunks are RUNNING but
 * have a resultJson (partial success), they are force-marked SUCCEEDED first.
 */
export async function finalizeCompletedChunks(jobId: string, userId: string): Promise<ChunkRecoveryResult> {
  const diagnostics = await diagnoseJobChunks(jobId, userId);
  if (!diagnostics) {
    return {
      ok: false,
      action: "finalize_completed",
      jobId,
      message: "Job not found",
      diagnostics: emptyDiagnostics(jobId, userId),
      affectedChunks: 0,
    };
  }

  await prismaReady;
  let affected = 0;

  // Force-terminal RUNNING chunks that have a resultJson (partial success)
  const runningWithResult = await prisma.aiAnalyzeChunk.findMany({
    where: { jobId, status: "RUNNING", resultJson: { not: null } },
    select: { id: true },
  });
  if (runningWithResult.length > 0) {
    const r = await prisma.aiAnalyzeChunk.updateMany({
      where: { id: { in: runningWithResult.map((c: any) => c.id) } },
      data: { status: "SUCCEEDED", finishedAt: new Date() },
    });
    affected += r.count;
  }

  // Force-terminal stale RUNNING chunks without a result (mark as FAILED)
  const staleThreshold = new Date(Date.now() - STALE_CHUNK_THRESHOLD_MS);
  const staleNoResult = await prisma.aiAnalyzeChunk.updateMany({
    where: {
      jobId,
      status: "RUNNING",
      resultJson: null,
      startedAt: { lt: staleThreshold },
    },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      errorMessage: "Force-failed by finalize recovery (stale, no result)",
      failureCategory: "STALE_TIMEOUT",
    },
  });
  affected += staleNoResult.count;

  await auditRecovery(jobId, userId, "finalize_completed", affected);

  // Now attempt finalization via the analysis-job-service
  try {
    const { finalizeJob } = await import("../ai-jobs/analysis-job-service");
    const finalizeResult = await finalizeJob(jobId, userId);
    const updatedDiagnostics = await diagnoseJobChunks(jobId, userId);
    return {
      ok: true,
      action: "finalize_completed",
      jobId,
      message: `Finalized ${affected} chunk(s). Job status: ${finalizeResult.status} (${finalizeResult.code ?? "OK"})`,
      diagnostics: updatedDiagnostics ?? diagnostics,
      affectedChunks: affected,
    };
  } catch (err) {
    const updatedDiagnostics = await diagnoseJobChunks(jobId, userId);
    return {
      ok: false,
      action: "finalize_completed",
      jobId,
      message: `Finalization failed: ${err instanceof Error ? err.message : String(err)}`,
      diagnostics: updatedDiagnostics ?? diagnostics,
      affectedChunks: affected,
    };
  }
}

/**
 * Restart the entire job — mark all non-terminal chunks as QUEUED and
 * reset the job to RUNNING so run-next can pick it up.
 */
export async function restartJob(jobId: string, userId: string): Promise<ChunkRecoveryResult> {
  const diagnostics = await diagnoseJobChunks(jobId, userId);
  if (!diagnostics) {
    return {
      ok: false,
      action: "restart",
      jobId,
      message: "Job not found",
      diagnostics: emptyDiagnostics(jobId, userId),
      affectedChunks: 0,
    };
  }

  await prismaReady;
  // Reset all FAILED/RUNNING/QUEUED chunks back to QUEUED
  const result = await prisma.aiAnalyzeChunk.updateMany({
    where: { jobId, status: { in: ["FAILED", "RUNNING", "QUEUED"] } },
    data: {
      status: "QUEUED",
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      failureCategory: null,
      resultJson: null,
    },
  });

  // Reset job to RUNNING
  await prisma.aiJob.update({
    where: { id: jobId },
    data: {
      status: "RUNNING",
      errorMessage: null,
      finishedAt: null,
    },
  });

  await auditRecovery(jobId, userId, "restart", result.count);

  const updatedDiagnostics = await diagnoseJobChunks(jobId, userId);
  return {
    ok: true,
    action: "restart",
    jobId,
    message: `Restarted job: reset ${result.count} chunk(s) to QUEUED. Job is now RUNNING — run-next will process them.`,
    diagnostics: updatedDiagnostics ?? diagnostics,
    affectedChunks: result.count,
  };
}

/**
 * Resume analysis — if there are QUEUED chunks, this just confirms the job
 * is RUNNING so run-next can pick them up. No chunk state changes needed.
 */
export async function resumeAnalysis(jobId: string, userId: string): Promise<ChunkRecoveryResult> {
  const diagnostics = await diagnoseJobChunks(jobId, userId);
  if (!diagnostics) {
    return {
      ok: false,
      action: "resume",
      jobId,
      message: "Job not found",
      diagnostics: emptyDiagnostics(jobId, userId),
      affectedChunks: 0,
    };
  }

  await prismaReady;
  await prisma.aiJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", errorMessage: null },
  });

  await auditRecovery(jobId, userId, "resume", 0);

  const updatedDiagnostics = await diagnoseJobChunks(jobId, userId);
  return {
    ok: true,
    action: "resume",
    jobId,
    message: "Job resumed — QUEUED chunks will be processed by run-next.",
    diagnostics: updatedDiagnostics ?? diagnostics,
    affectedChunks: 0,
  };
}

async function auditRecovery(jobId: string, userId: string, action: string, affected: number): Promise<void> {
  try {
    await logAction({
      userId,
      action: "TENDER_ANALYSIS_RUN",
      entityType: "AiJob",
      entityId: jobId,
      description: `AI job recovery: ${action} (${affected} chunk(s) affected)`,
      metadata: { jobId, action, affectedChunks: affected, recoveryId: randomUUID() },
    });
  } catch {
    // Audit is best-effort
  }
}

function emptyDiagnostics(jobId: string, userId: string): ChunkRecoveryDiagnostics {
  return {
    jobId,
    tenderId: null,
    userId,
    totalChunks: 0,
    queuedCount: 0,
    runningCount: 0,
    succeededCount: 0,
    failedCount: 0,
    skippedCount: 0,
    staleRunningCount: 0,
    freshRunningCount: 0,
    promotionStatus: "UNKNOWN",
    promotionCode: null,
    recoverable: false,
    recoverActions: [],
    oldestRunningStartedAt: null,
    newestChunkUpdatedAt: null,
  };
}
