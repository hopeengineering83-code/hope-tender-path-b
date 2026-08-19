import type { Prisma, PrismaClient } from "@prisma/client";
import type { StorageAdapter } from "../storage";
import { logger } from "../observability";

export const TENDER_STORAGE_CLEANUP_PENDING = "TENDER_STORAGE_CLEANUP_PENDING";
export const TENDER_STORAGE_CLEANUP_RUNNING = "TENDER_STORAGE_CLEANUP_RUNNING";
export const TENDER_STORAGE_CLEANUP_COMPLETED = "TENDER_STORAGE_CLEANUP_COMPLETED";
export const TENDER_STORAGE_CLEANUP_INVALID = "TENDER_STORAGE_CLEANUP_INVALID";

const CLEANUP_ENTITY_TYPE = "TenderStorageCleanup";
const STALE_CLAIM_MS = 15 * 60 * 1000;

export type TenderExternalStorageObject = {
  storagePath: string;
  fileName: string;
};

type TenderStorageCleanupManifest = {
  version: 1;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "INVALID";
  tenderId: string;
  correlationId: string;
  attempts: number;
  files: TenderExternalStorageObject[];
  createdAt: string;
  lastAttemptAt?: string;
  completedAt?: string;
  cleanedCount?: number;
  failureCount?: number;
};

export type TenderStorageCleanupResult = {
  found: boolean;
  claimed: boolean;
  completed: boolean;
  cleaned: number;
  remaining: number;
  failures: number;
};

function normalizeFiles(
  files: ReadonlyArray<{
    storagePath?: string | null;
    fileName?: string | null;
  }>,
): TenderExternalStorageObject[] {
  const byPath = new Map<string, TenderExternalStorageObject>();
  for (const file of files) {
    const storagePath = file.storagePath?.trim();
    if (!storagePath) continue;
    if (!byPath.has(storagePath)) {
      byPath.set(storagePath, {
        storagePath,
        fileName: file.fileName?.trim() || "stored-file",
      });
    }
  }
  return Array.from(byPath.values());
}

function parseManifest(value: string): TenderStorageCleanupManifest | null {
  try {
    const parsed = JSON.parse(value) as Partial<TenderStorageCleanupManifest>;
    if (
      parsed.version !== 1 ||
      typeof parsed.tenderId !== "string" ||
      typeof parsed.correlationId !== "string" ||
      !Array.isArray(parsed.files)
    ) return null;

    const files = normalizeFiles(parsed.files);
    return {
      version: 1,
      status:
        parsed.status === "RUNNING" ||
        parsed.status === "COMPLETED" ||
        parsed.status === "INVALID"
          ? parsed.status
          : "PENDING",
      tenderId: parsed.tenderId,
      correlationId: parsed.correlationId,
      attempts: Number.isInteger(parsed.attempts) && (parsed.attempts ?? 0) >= 0
        ? Number(parsed.attempts)
        : 0,
      files,
      createdAt: typeof parsed.createdAt === "string"
        ? parsed.createdAt
        : new Date(0).toISOString(),
      lastAttemptAt: typeof parsed.lastAttemptAt === "string"
        ? parsed.lastAttemptAt
        : undefined,
      completedAt: typeof parsed.completedAt === "string"
        ? parsed.completedAt
        : undefined,
      cleanedCount: typeof parsed.cleanedCount === "number"
        ? parsed.cleanedCount
        : undefined,
      failureCount: typeof parsed.failureCount === "number"
        ? parsed.failureCount
        : undefined,
    };
  } catch (e) {
    // JSON.parse of cleanup-task metadata failed — return null so the caller
    // treats the task as not-yet-attempted and can re-run. Surface the failure
    // so corrupted metadata rows are visible to operators (a series of these
    // suggests a serialization bug, not a one-off bad row).
    // Previously bare `catch {}` — silently returned null on every malformed row.
    logger.warn("[tender-storage-cleanup-task] failed to parse cleanup task metadata — treating as not-yet-attempted", {
      detail: e,
    });
    return null;
  }
}

export async function createTenderStorageCleanupTask(args: {
  tx: Prisma.TransactionClient;
  userId: string;
  tenderId: string;
  correlationId: string;
  files: ReadonlyArray<{
    storagePath?: string | null;
    fileName?: string | null;
  }>;
  now?: Date;
}): Promise<string | null> {
  const files = normalizeFiles(args.files);
  if (files.length === 0) return null;

  const now = args.now ?? new Date();
  const manifest: TenderStorageCleanupManifest = {
    version: 1,
    status: "PENDING",
    tenderId: args.tenderId,
    correlationId: args.correlationId,
    attempts: 0,
    files,
    createdAt: now.toISOString(),
  };

  const task = await args.tx.auditLog.create({
    data: {
      userId: args.userId,
      action: TENDER_STORAGE_CLEANUP_PENDING,
      entityType: CLEANUP_ENTITY_TYPE,
      entityId: args.tenderId,
      description: "External tender storage cleanup pending after durable tender deletion",
      metadata: JSON.stringify(manifest),
    },
    select: { id: true },
  });

  return task.id;
}

function claimIsFresh(manifest: TenderStorageCleanupManifest, now: Date): boolean {
  if (manifest.status !== "RUNNING" || !manifest.lastAttemptAt) return false;
  const timestamp = new Date(manifest.lastAttemptAt).getTime();
  return Number.isFinite(timestamp) && now.getTime() - timestamp < STALE_CLAIM_MS;
}

export async function processTenderStorageCleanupTask(args: {
  prisma: PrismaClient;
  storage: StorageAdapter;
  taskId: string;
  now?: Date;
}): Promise<TenderStorageCleanupResult> {
  const now = args.now ?? new Date();
  const task = await args.prisma.auditLog.findFirst({
    where: {
      id: args.taskId,
      entityType: CLEANUP_ENTITY_TYPE,
      action: {
        in: [
          TENDER_STORAGE_CLEANUP_PENDING,
          TENDER_STORAGE_CLEANUP_RUNNING,
        ],
      },
    },
    select: {
      id: true,
      action: true,
      metadata: true,
    },
  });

  if (!task) {
    return {
      found: false,
      claimed: false,
      completed: false,
      cleaned: 0,
      remaining: 0,
      failures: 0,
    };
  }

  const manifest = parseManifest(task.metadata);
  if (!manifest) {
    await args.prisma.auditLog.updateMany({
      where: { id: task.id, action: task.action },
      data: {
        action: TENDER_STORAGE_CLEANUP_INVALID,
        // Preserve the original internal bytes. Even malformed JSON may
        // contain the only recoverable storage pointers for operator repair.
        description: "Tender storage cleanup task is invalid and requires operator review",
      },
    });
    return {
      found: true,
      claimed: false,
      completed: false,
      cleaned: 0,
      remaining: 0,
      failures: 1,
    };
  }

  if (claimIsFresh(manifest, now)) {
    return {
      found: true,
      claimed: false,
      completed: false,
      cleaned: 0,
      remaining: manifest.files.length,
      failures: 0,
    };
  }

  const runningManifest: TenderStorageCleanupManifest = {
    ...manifest,
    status: "RUNNING",
    attempts: manifest.attempts + 1,
    lastAttemptAt: now.toISOString(),
  };
  const claim = await args.prisma.auditLog.updateMany({
    // The exact prior manifest is the optimistic version token. This is
    // required when reclaiming stale RUNNING tasks because the action
    // remains RUNNING; action-only matching could let two workers claim.
    where: {
      id: task.id,
      action: task.action,
      metadata: task.metadata,
    },
    data: {
      action: TENDER_STORAGE_CLEANUP_RUNNING,
      description: "External tender storage cleanup is running",
      metadata: JSON.stringify(runningManifest),
    },
  });
  if (claim.count !== 1) {
    return {
      found: true,
      claimed: false,
      completed: false,
      cleaned: 0,
      remaining: manifest.files.length,
      failures: 0,
    };
  }

  const remaining: TenderExternalStorageObject[] = [];
  let cleaned = 0;
  let failures = 0;
  for (const file of manifest.files) {
    try {
      await args.storage.deleteFile({
        storagePath: file.storagePath,
        fileContent: null,
        fileName: file.fileName,
      });
      cleaned += 1;
    } catch (error) {
      failures += 1;
      remaining.push(file);
      logger.warn("[tender-storage-cleanup] external delete deferred", {
        taskId: task.id,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
    }
  }

  const completed = remaining.length === 0;
  const finalManifest: TenderStorageCleanupManifest = {
    ...runningManifest,
    status: completed ? "COMPLETED" : "PENDING",
    files: remaining,
    cleanedCount: (manifest.cleanedCount ?? 0) + cleaned,
    failureCount: (manifest.failureCount ?? 0) + failures,
    ...(completed ? { completedAt: now.toISOString() } : {}),
  };

  await args.prisma.auditLog.update({
    where: { id: task.id },
    data: {
      action: completed
        ? TENDER_STORAGE_CLEANUP_COMPLETED
        : TENDER_STORAGE_CLEANUP_PENDING,
      description: completed
        ? "External tender storage cleanup completed"
        : "External tender storage cleanup remains pending for retry",
      metadata: JSON.stringify(finalManifest),
    },
  });

  return {
    found: true,
    claimed: true,
    completed,
    cleaned,
    remaining: remaining.length,
    failures,
  };
}

export async function processPendingTenderStorageCleanupTasks(args: {
  prisma: PrismaClient;
  storage: StorageAdapter;
  limit?: number;
  now?: Date;
}): Promise<{
  candidates: number;
  claimed: number;
  completed: number;
  cleaned: number;
  remaining: number;
  failures: number;
}> {
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
  const tasks = await args.prisma.auditLog.findMany({
    where: {
      entityType: CLEANUP_ENTITY_TYPE,
      action: {
        in: [
          TENDER_STORAGE_CLEANUP_PENDING,
          TENDER_STORAGE_CLEANUP_RUNNING,
        ],
      },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });

  const totals = {
    candidates: tasks.length,
    claimed: 0,
    completed: 0,
    cleaned: 0,
    remaining: 0,
    failures: 0,
  };

  for (const task of tasks) {
    const result = await processTenderStorageCleanupTask({
      prisma: args.prisma,
      storage: args.storage,
      taskId: task.id,
      now: args.now,
    });
    if (result.claimed) totals.claimed += 1;
    if (result.completed) totals.completed += 1;
    totals.cleaned += result.cleaned;
    totals.remaining += result.remaining;
    totals.failures += result.failures;
  }

  return totals;
}
