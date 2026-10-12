import { logger } from "./observability";
import crypto from "crypto";
import { prisma } from "./prisma";
import { safeParseJsonObject } from "./safe-json";
import { redactSecrets } from "./sanitize-error";
import type { AIAnalysisResult, ChunkResult } from "./ai";

export class AiAnalyzeCheckpointPersistenceError extends Error {
  readonly code = "AI_ANALYZE_CHECKPOINT_PERSISTENCE_FAILED";
  constructor(
    readonly operation: string,
    readonly diagnosticId: string,
    readonly tenderId: string,
    readonly chunkIndex: number | null,
    readonly contentHashPrefix: string,
    cause: unknown,
  ) {
    const safeClass = cause instanceof Error ? cause.constructor.name : "UnknownError";
    super(`Checkpoint ${operation} failed [${diagnosticId}]: ${safeClass}`);
    this.name = "AiAnalyzeCheckpointPersistenceError";
  }
}

type CheckpointIdentity = {
  tenderId: string;
  userId: string;
  contentHash: string;
};

type ChunkIdentity = CheckpointIdentity & {
  chunkIndex: number;
  totalChunks: number;
};

export type AiAnalyzeCheckpointProgress = {
  completedChunks: number;
  totalChunks: number;
  failedChunks: number;
  progressPercent: number;
  resumeAvailable: boolean;
};

function cleanErrorMessage(errorMessage: string | null | undefined): string | null {
  if (!errorMessage) return null;
  // Delegate to canonical redactSecrets() so patterns cannot diverge.
  return redactSecrets(errorMessage).slice(0, 300);
}

function parseChunkResult(resultJson: string | null | undefined): AIAnalysisResult | null {
  const parsed = safeParseJsonObject(resultJson);
  if (!parsed || typeof parsed.summary !== "string" || !Array.isArray(parsed.requirements)) return null;
  return parsed as AIAnalysisResult;
}

export async function getAnalyzeCheckpoints(tenderId: string, userId: string, contentHash: string) {
  const diagnosticId = crypto.randomUUID();
  const operation = "getAnalyzeCheckpoints";
  try {
    return await prisma.aiAnalyzeChunk.findMany({
      where: { tenderId, userId, contentHash },
      orderBy: { chunkIndex: "asc" },
    });
  } catch (err) {
    logger.error("[ai-analyze-checkpoints]", {
      code: "AI_ANALYZE_CHECKPOINT_PERSISTENCE_FAILED",
      operation,
      diagnosticId,
      tenderId,
      chunkIndex: null,
      contentHashPrefix: contentHash.slice(0, 8),
    });
    throw new AiAnalyzeCheckpointPersistenceError(operation, diagnosticId, tenderId, null, contentHash.slice(0, 8), err);
  }
}

export async function upsertAnalyzeChunkStarted(input: ChunkIdentity) {
  const diagnosticId = crypto.randomUUID();
  const operation = "upsertAnalyzeChunkStarted";
  const now = new Date();
  try {
    await prisma.aiAnalyzeChunk.upsert({
      where: {
        tenderId_userId_contentHash_chunkIndex: {
          tenderId: input.tenderId,
          userId: input.userId,
          contentHash: input.contentHash,
          chunkIndex: input.chunkIndex,
        },
      },
      create: {
        tenderId: input.tenderId,
        userId: input.userId,
        contentHash: input.contentHash,
        chunkIndex: input.chunkIndex,
        totalChunks: input.totalChunks,
        status: "RUNNING",
        startedAt: now,
      },
      update: {
        totalChunks: input.totalChunks,
        status: "RUNNING",
        errorMessage: null,
        startedAt: now,
        finishedAt: null,
      },
    });
  } catch (err) {
    logger.error("[ai-analyze-checkpoints]", {
      code: "AI_ANALYZE_CHECKPOINT_PERSISTENCE_FAILED",
      operation,
      diagnosticId,
      tenderId: input.tenderId,
      chunkIndex: input.chunkIndex,
      contentHashPrefix: input.contentHash.slice(0, 8),
    });
    throw new AiAnalyzeCheckpointPersistenceError(operation, diagnosticId, input.tenderId, input.chunkIndex, input.contentHash.slice(0, 8), err);
  }
}

export async function upsertAnalyzeChunkSucceeded(input: ChunkIdentity & { provider?: string | null; result: AIAnalysisResult }) {
  const diagnosticId = crypto.randomUUID();
  const operation = "upsertAnalyzeChunkSucceeded";
  const now = new Date();
  try {
    await prisma.aiAnalyzeChunk.upsert({
      where: {
        tenderId_userId_contentHash_chunkIndex: {
          tenderId: input.tenderId,
          userId: input.userId,
          contentHash: input.contentHash,
          chunkIndex: input.chunkIndex,
        },
      },
      create: {
        tenderId: input.tenderId,
        userId: input.userId,
        contentHash: input.contentHash,
        chunkIndex: input.chunkIndex,
        totalChunks: input.totalChunks,
        status: "SUCCEEDED",
        provider: input.provider ?? null,
        resultJson: JSON.stringify(input.result),
        startedAt: now,
        finishedAt: now,
      },
      update: {
        totalChunks: input.totalChunks,
        status: "SUCCEEDED",
        provider: input.provider ?? null,
        resultJson: JSON.stringify(input.result),
        errorMessage: null,
        finishedAt: now,
      },
    });
  } catch (err) {
    logger.error("[ai-analyze-checkpoints]", {
      code: "AI_ANALYZE_CHECKPOINT_PERSISTENCE_FAILED",
      operation,
      diagnosticId,
      tenderId: input.tenderId,
      chunkIndex: input.chunkIndex,
      contentHashPrefix: input.contentHash.slice(0, 8),
    });
    throw new AiAnalyzeCheckpointPersistenceError(operation, diagnosticId, input.tenderId, input.chunkIndex, input.contentHash.slice(0, 8), err);
  }
}

export async function upsertAnalyzeChunkFailed(input: ChunkIdentity & { provider?: string | null; errorMessage: string }) {
  const diagnosticId = crypto.randomUUID();
  const operation = "upsertAnalyzeChunkFailed";
  const now = new Date();
  try {
    await prisma.aiAnalyzeChunk.upsert({
      where: {
        tenderId_userId_contentHash_chunkIndex: {
          tenderId: input.tenderId,
          userId: input.userId,
          contentHash: input.contentHash,
          chunkIndex: input.chunkIndex,
        },
      },
      create: {
        tenderId: input.tenderId,
        userId: input.userId,
        contentHash: input.contentHash,
        chunkIndex: input.chunkIndex,
        totalChunks: input.totalChunks,
        status: "FAILED",
        provider: input.provider ?? null,
        errorMessage: cleanErrorMessage(input.errorMessage),
        startedAt: now,
        finishedAt: now,
      },
      update: {
        totalChunks: input.totalChunks,
        status: "FAILED",
        provider: input.provider ?? null,
        errorMessage: cleanErrorMessage(input.errorMessage),
        finishedAt: now,
      },
    });
  } catch (err) {
    logger.error("[ai-analyze-checkpoints]", {
      code: "AI_ANALYZE_CHECKPOINT_PERSISTENCE_FAILED",
      operation,
      diagnosticId,
      tenderId: input.tenderId,
      chunkIndex: input.chunkIndex,
      contentHashPrefix: input.contentHash.slice(0, 8),
    });
    throw new AiAnalyzeCheckpointPersistenceError(operation, diagnosticId, input.tenderId, input.chunkIndex, input.contentHash.slice(0, 8), err);
  }
}

export async function getCompletedChunkResults(tenderId: string, userId: string, contentHash: string): Promise<ChunkResult[]> {
  const rows = await getAnalyzeCheckpoints(tenderId, userId, contentHash);
  const completed: ChunkResult[] = [];
  for (const row of rows) {
    if (row.status !== "SUCCEEDED") continue;
    const result = parseChunkResult(row.resultJson);
    if (!result) continue;
    completed.push({ index: row.chunkIndex, result, provider: row.provider ?? null });
  }
  return completed.sort((a, b) => a.index - b.index);
}

export async function getAnalyzeProgress(tenderId: string, userId: string, contentHash: string): Promise<AiAnalyzeCheckpointProgress> {
  const rows = await getAnalyzeCheckpoints(tenderId, userId, contentHash);
  const totalChunks = rows.reduce((max, row) => Math.max(max, row.totalChunks), 0);
  const completedChunks = rows.filter((row) => row.status === "SUCCEEDED").length;
  const failedChunks = rows.filter((row) => row.status === "FAILED").length;
  const progressPercent = totalChunks > 0 ? Math.round((completedChunks / totalChunks) * 100) : 0;
  return {
    completedChunks,
    totalChunks,
    failedChunks,
    progressPercent,
    resumeAvailable: completedChunks > 0 && completedChunks < totalChunks,
  };
}

export async function getLatestAnalyzeCheckpointProgress(tenderId: string, userId: string): Promise<AiAnalyzeCheckpointProgress | null> {
  const diagnosticId = crypto.randomUUID();
  const operation = "getLatestAnalyzeCheckpointProgress";
  let latest: { contentHash: string } | null;
  try {
    latest = await prisma.aiAnalyzeChunk.findFirst({
      where: { tenderId, userId },
      orderBy: { updatedAt: "desc" },
      select: { contentHash: true },
    });
  } catch (err) {
    logger.error("[ai-analyze-checkpoints]", {
      code: "AI_ANALYZE_CHECKPOINT_PERSISTENCE_FAILED",
      operation,
      diagnosticId,
      tenderId,
      chunkIndex: null,
      contentHashPrefix: null,
    });
    throw new AiAnalyzeCheckpointPersistenceError(operation, diagnosticId, tenderId, null, "", err);
  }
  if (!latest) return null;
  return getAnalyzeProgress(tenderId, userId, latest.contentHash);
}


export async function clearAnalyzeCheckpoints(tenderId: string, userId: string, contentHash: string) {
  const diagnosticId = crypto.randomUUID();
  const operation = "clearAnalyzeCheckpoints";
  try {
    await prisma.aiAnalyzeChunk.deleteMany({
      where: { tenderId, userId, contentHash },
    });
  } catch (err) {
    logger.error("[ai-analyze-checkpoints]", {
      code: "AI_ANALYZE_CHECKPOINT_PERSISTENCE_FAILED",
      operation,
      diagnosticId,
      tenderId,
      chunkIndex: null,
      contentHashPrefix: contentHash.slice(0, 8),
    });
    throw new AiAnalyzeCheckpointPersistenceError(operation, diagnosticId, tenderId, null, contentHash.slice(0, 8), err);
  }
}

export async function clearAnalyzeCheckpointsForContentHashMismatch(tenderId: string, userId: string, contentHash: string) {
  const diagnosticId = crypto.randomUUID();
  const operation = "clearAnalyzeCheckpointsForContentHashMismatch";
  try {
    await prisma.aiAnalyzeChunk.deleteMany({
      where: { tenderId, userId, contentHash: { not: contentHash } },
    });
  } catch (err) {
    logger.error("[ai-analyze-checkpoints]", {
      code: "AI_ANALYZE_CHECKPOINT_PERSISTENCE_FAILED",
      operation,
      diagnosticId,
      tenderId,
      chunkIndex: null,
      contentHashPrefix: contentHash.slice(0, 8),
    });
    throw new AiAnalyzeCheckpointPersistenceError(operation, diagnosticId, tenderId, null, contentHash.slice(0, 8), err);
  }
}
