/**
 * Upload Intake Session Tracker
 *
 * Provides idempotent tender-package intake. Each upload-first request
 * creates an intake session. Additional batches reference the same session
 * ID. The server tracks expected vs. received batches and only enqueues
 * AI_ANALYZE when all batches are committed.
 *
 * A one-batch upload also enqueues AI_ANALYZE — the session is finalized
 * immediately.
 *
 * If the browser crashes between batch 1 and batch 2, the user can resume
 * using the session ID. The server preserves successfully stored files and
 * identifies failed/missing batches.
 */

import { prisma, prismaReady } from "../prisma";
import { logger } from "../observability";

// ─── Types ──────────────────────────────────────────────────────────────────

export type IntakeSession = {
  id: string;
  tenderId: string;
  userId: string;
  status: "open" | "finalized" | "abandoned";
  expectedBatches: number;
  receivedBatches: number;
  createdAt: Date;
  finalizedAt: Date | null;
};

export type IntakeBatchRecord = {
  id: string;
  sessionId: string;
  batchIndex: number;
  fileCount: number;
  fileNames: string[];
  sourceHashes: string[];
  status: "committed" | "failed";
  createdAt: Date;
};

// ─── Session management ─────────────────────────────────────────────────────

/**
 * Create a new intake session.
 *
 * Called by the upload-first handler when a new tender package starts.
 * The session ID is returned to the client and included in subsequent
 * batch uploads.
 */
export async function createIntakeSession(options: {
  tenderId: string;
  userId: string;
  expectedBatches: number;
}): Promise<IntakeSession> {
  await prismaReady;

  // Use a deterministic session ID based on tenderId + userId + timestamp
  // so a duplicate request (e.g. retry) returns the same session.
  const { createHash } = await import("node:crypto");
  const sessionKey = `${options.tenderId}:${options.userId}:${Date.now()}`;
  const sessionId = createHash("sha256").update(sessionKey).digest("hex").slice(0, 24);

  // Store the session in the AiJob table as a metadata record
  // (avoids a new table/migration). The jobType is "INTAKE_SESSION" — a
  // pseudo-job that never runs, just tracks session state.
  await prisma.aiJob.create({
    data: {
      id: sessionId,
      jobType: "INTAKE_SESSION",
      status: "QUEUED", // "open"
      userId: options.userId,
      tenderId: options.tenderId,
      input: JSON.stringify({
        sessionId,
        tenderId: options.tenderId,
        expectedBatches: options.expectedBatches,
        receivedBatches: 0,
        status: "open",
        createdAt: new Date().toISOString(),
      }),
    },
  });

  logger.info("[intake-session] created", {
    sessionId,
    tenderId: options.tenderId,
    expectedBatches: options.expectedBatches,
  });

  return {
    id: sessionId,
    tenderId: options.tenderId,
    userId: options.userId,
    status: "open",
    expectedBatches: options.expectedBatches,
    receivedBatches: 0,
    createdAt: new Date(),
    finalizedAt: null,
  };
}

/**
 * Record a committed batch in the intake session.
 *
 * Called by /api/upload after each batch is successfully stored.
 * Increments the receivedBatches counter. If receivedBatches ===
 * expectedBatches, the session is finalized.
 */
export async function recordIntakeBatch(options: {
  sessionId: string;
  tenderId: string;
  userId: string;
  batchIndex: number;
  fileCount: number;
  fileNames: string[];
  sourceHashes: string[];
}): Promise<{ sessionFinalized: boolean; receivedBatches: number; expectedBatches: number }> {
  await prismaReady;

  // Load the session
  const sessionJob = await prisma.aiJob.findUnique({
    where: { id: options.sessionId },
    select: { id: true, input: true, status: true },
  });

  if (!sessionJob) {
    throw new Error(`Intake session ${options.sessionId} not found`);
  }

  const sessionInput = JSON.parse(sessionJob.input) as {
    sessionId: string;
    tenderId: string;
    expectedBatches: number;
    receivedBatches: number;
    status: string;
  };

  // Increment receivedBatches
  const newReceivedBatches = sessionInput.receivedBatches + 1;
  const sessionFinalized = newReceivedBatches >= sessionInput.expectedBatches;

  // Update the session
  await prisma.aiJob.update({
    where: { id: options.sessionId },
    data: {
      input: JSON.stringify({
        ...sessionInput,
        receivedBatches: newReceivedBatches,
        status: sessionFinalized ? "finalized" : "open",
        finalizedAt: sessionFinalized ? new Date().toISOString() : undefined,
      }),
      status: sessionFinalized ? "SUCCEEDED" : "QUEUED",
    },
  });

  logger.info("[intake-session] batch recorded", {
    sessionId: options.sessionId,
    batchIndex: options.batchIndex,
    fileCount: options.fileCount,
    receivedBatches: newReceivedBatches,
    expectedBatches: sessionInput.expectedBatches,
    finalized: sessionFinalized,
  });

  return {
    sessionFinalized,
    receivedBatches: newReceivedBatches,
    expectedBatches: sessionInput.expectedBatches,
  };
}

/**
 * Check if an intake session is finalized (all batches received).
 */
export async function isIntakeSessionFinalized(sessionId: string): Promise<boolean> {
  await prismaReady;
  const sessionJob = await prisma.aiJob.findUnique({
    where: { id: sessionId },
    select: { status: true, input: true },
  });
  if (!sessionJob) return false;
  return sessionJob.status === "SUCCEEDED";
}

/**
 * Get the intake session state.
 */
export async function getIntakeSession(sessionId: string): Promise<IntakeSession | null> {
  await prismaReady;
  const sessionJob = await prisma.aiJob.findUnique({
    where: { id: sessionId },
    select: { id: true, input: true, status: true, tenderId: true, userId: true, createdAt: true },
  });
  if (!sessionJob) return null;

  const input = JSON.parse(sessionJob.input) as {
    expectedBatches: number;
    receivedBatches: number;
    status: string;
    finalizedAt?: string;
  };

  return {
    id: sessionJob.id,
    tenderId: sessionJob.tenderId!,
    userId: sessionJob.userId,
    status: input.status as IntakeSession["status"],
    expectedBatches: input.expectedBatches,
    receivedBatches: input.receivedBatches,
    createdAt: sessionJob.createdAt,
    finalizedAt: input.finalizedAt ? new Date(input.finalizedAt) : null,
  };
}
