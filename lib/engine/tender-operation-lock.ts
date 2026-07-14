/**
 * Tender Operation Lock / Idempotency
 *
 * DB-backed per-tender operation locking using the existing
 * TenderWorkflowRun model. Prevents concurrent duplicate operations
 * (AI Analyze, Generate, Export, etc.) from corrupting tender state.
 *
 * Lock TTL: 10 minutes (configurable). Failed/stale locks auto-expire.
 *
 * This module is consumed by:
 *   - app/api/tenders/[id]/ai-analyze/route.ts
 *   - app/api/tenders/[id]/generate/route.ts
 *   - app/api/tenders/[id]/export/route.ts
 *   - app/api/tenders/[id]/download/route.ts (zipPackage)
 *   - app/api/tenders/[id]/generate-missing-plan-files/route.ts
 *   - app/api/tenders/[id]/validate/route.ts
 *
 * Non-goals: UI rendering, provider routing, schema migration.
 */

import type { PrismaClient } from "@prisma/client";
import { childLogger } from "../observability";

// ─── Types ──────────────────────────────────────────────────────────────────

export type TenderOperation =
  | "AI_ANALYZE"
  | "BUILD_PLAN"
  | "GENERATE_DOCUMENTS"
  | "VALIDATE_DOCUMENTS"
  | "APPROVE_DOCUMENTS"
  | "EXPORT_PACKAGE"
  | "DOWNLOAD_PACKAGE";

export type LockResult =
  | { acquired: true; runId: string }
  | { acquired: false; reason: "ALREADY_RUNNING"; existingRunId: string; startedAt: Date }
  | { acquired: false; reason: "ERROR"; message: string };

export type OperationCompletion = {
  runId: string;
  status: "SUCCEEDED" | "FAILED";
  errorCode?: string;
  errorMessage?: string;
  resultJson?: Record<string, unknown>;
};

// Lock TTL: 10 minutes. After this, a stale lock can be force-acquired.
const LOCK_TTL_MS = 10 * 60 * 1000;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Attempt to acquire an operation lock for a tender.
 *
 * If another active (non-expired) lock exists for the same tender + operation,
 * returns ALREADY_RUNNING with the existing run ID.
 *
 * Uses a DB-backed approach via TenderWorkflowRun:
 *   1. Check for existing RUNNING row with matching (tenderId, operation).
 *   2. If found and not expired → ALREADY_RUNNING.
 *   3. If found and expired → mark as FAILED (STALE) and acquire new.
 *   4. If not found → insert new RUNNING row (the unique index prevents races).
 *
 * @param prisma - PrismaClient instance
 * @param tenderId - The tender to lock
 * @param companyId - The company that owns the tender
 * @param operation - The operation type
 * @param userId - The user initiating the operation
 * @returns LockResult indicating success or why it failed
 */
export async function acquireTenderOperationLock(
  prisma: PrismaClient,
  tenderId: string,
  companyId: string,
  operation: TenderOperation,
  userId: string,
): Promise<LockResult> {
  const logger = childLogger({ module: "[tender-operation-lock]" });
  // Derive idempotencyKey deterministically from (tenderId, operation) so
  // two concurrent requests for the same tender+operation collide on the
  // unique index. The previous `${operation}-${Date.now()}` made every
  // request unique, so the unique index could NEVER fire — concurrent
  // engine/generate/export runs were not prevented. The timestamp is
  // still included as a separate column (createdAt) for staleness checks.
  const idempotencyKey = `${operation}`;
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - LOCK_TTL_MS);

  try {
    // 1. Check for existing RUNNING lock
    const existing = await (prisma as any).tenderWorkflowRun.findFirst({
      where: {
        tenderId,
        operation,
        status: "RUNNING",
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, startedAt: true, createdAt: true },
    });

    if (existing) {
      const lockAge = existing.startedAt ?? existing.createdAt;
      if (lockAge > staleThreshold) {
        // Lock is still fresh — block
        logger.info(`Lock denied: ${operation} already running for tender=${tenderId} runId=${existing.id}`);
        return {
          acquired: false,
          reason: "ALREADY_RUNNING",
          existingRunId: existing.id,
          startedAt: lockAge,
        };
      }
      // Lock is stale — mark as FAILED and continue to acquire new
      await (prisma as any).tenderWorkflowRun.update({
        where: { id: existing.id },
        data: {
          status: "FAILED",
          errorCode: "STALE_LOCK_EXPIRED",
          errorMessage: "Lock expired without completion",
          finishedAt: now,
        },
      }).catch(() => {});
      logger.info(`Stale lock expired: ${operation} for tender=${tenderId} oldRunId=${existing.id}`);
    }

    // 2. Insert new RUNNING lock (unique index prevents concurrent races)
    const run = await (prisma as any).tenderWorkflowRun.create({
      data: {
        companyId,
        tenderId,
        operation,
        idempotencyKey,
        status: "RUNNING",
        startedAt: now,
      },
      select: { id: true },
    });

    logger.info(`Lock acquired: ${operation} for tender=${tenderId} runId=${run.id}`);
    return { acquired: true, runId: run.id };
  } catch (error: unknown) {
    // P2002 = unique constraint violation — another request won the race
    const errCode = (error as { code?: string })?.code;
    if (errCode === "P2002") {
      // Re-fetch the winner
      const winner = await (prisma as any).tenderWorkflowRun.findFirst({
        where: { tenderId, operation, status: "RUNNING" },
        orderBy: { createdAt: "desc" },
        select: { id: true, startedAt: true },
      });
      if (winner) {
        return {
          acquired: false,
          reason: "ALREADY_RUNNING",
          existingRunId: winner.id,
          startedAt: winner.startedAt ?? now,
        };
      }
    }
    const msg = error instanceof Error ? error.constructor.name : "UnknownError";
    logger.error(`Lock acquisition failed: ${operation} tender=${tenderId} error=${msg}`);
    return { acquired: false, reason: "ERROR", message: "Operation lock failed. Refresh to retry." };
  }
}

/**
 * Release an operation lock by marking it as completed.
 *
 * @param prisma - PrismaClient instance
 * @param runId - The run ID returned by acquireTenderOperationLock
 * @param completion - The completion status and metadata
 */
export async function releaseTenderOperationLock(
  prisma: PrismaClient,
  runId: string,
  completion: OperationCompletion,
): Promise<void> {
  const logger = childLogger({ module: "[tender-operation-lock]" });
  try {
    await (prisma as any).tenderWorkflowRun.update({
      where: { id: runId },
      data: {
        status: completion.status,
        errorCode: completion.errorCode ?? null,
        errorMessage: completion.errorMessage ?? null,
        resultJson: completion.resultJson ?? undefined,
        finishedAt: new Date(),
      },
    });
    logger.info(`Lock released: runId=${runId} status=${completion.status}`);
  } catch {
    // Best-effort — the lock will expire via TTL if this fails
    logger.warn(`Lock release failed (best-effort): runId=${runId}`);
  }
}

/**
 * Check if an operation is currently running for a tender.
 * Read-only — does not acquire a lock.
 */
export async function isOperationRunning(
  prisma: PrismaClient,
  tenderId: string,
  operation: TenderOperation,
): Promise<boolean> {
  const staleThreshold = new Date(Date.now() - LOCK_TTL_MS);
  const existing = await (prisma as any).tenderWorkflowRun.findFirst({
    where: {
      tenderId,
      operation,
      status: "RUNNING",
      startedAt: { gt: staleThreshold },
    },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Wrap an async operation with acquire/release lock semantics.
 *
 * Usage:
 *   const result = await withTenderOperationLock(
 *     prisma, tenderId, companyId, "GENERATE_DOCUMENTS", userId,
 *     async () => { ... generate docs ... return { documentsCreated: 3 }; }
 *   );
 */
export async function withTenderOperationLock<T>(
  prisma: PrismaClient,
  tenderId: string,
  companyId: string,
  operation: TenderOperation,
  userId: string,
  fn: () => Promise<T>,
): Promise<
  | { ok: true; result: T; runId: string }
  | { ok: false; reason: "ALREADY_RUNNING"; existingRunId: string }
  | { ok: false; reason: "ERROR"; message: string }
> {
  const lock = await acquireTenderOperationLock(prisma, tenderId, companyId, operation, userId);
  if (!lock.acquired) {
    if (lock.reason === "ALREADY_RUNNING") {
      return { ok: false as const, reason: "ALREADY_RUNNING" as const, existingRunId: lock.existingRunId };
    }
    return { ok: false as const, reason: "ERROR" as const, message: lock.message };
  }

  try {
    const result = await fn();
    await releaseTenderOperationLock(prisma, lock.runId, {
      runId: lock.runId,
      status: "SUCCEEDED",
    });
    return { ok: true, result, runId: lock.runId };
  } catch (error: unknown) {
    const errorCode = error instanceof Error ? error.constructor.name : "UNKNOWN_ERROR";
    await releaseTenderOperationLock(prisma, lock.runId, {
      runId: lock.runId,
      status: "FAILED",
      errorCode,
      errorMessage: "Operation failed during execution",
    });
    throw error; // Re-throw so the route handler can return its own error
  }
}
