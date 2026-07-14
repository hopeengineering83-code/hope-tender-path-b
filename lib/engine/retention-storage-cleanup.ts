import type { PrismaClient } from "@prisma/client";
import type { StorageAdapter } from "../storage";
import { logger } from "../observability";

export type RetentionCleanupResult = {
  candidates: number;
  rowsDeleted: number;
  blobsCleaned: number;
  failures: number;
};

type TenderFileCandidate = {
  id: string;
  storagePath: string;
  fileContent: string | null;
  originalFileName: string;
};

type GeneratedDocumentCandidate = {
  id: string;
  storagePath: string | null;
  fileContent: string | null;
  exactFileName: string | null;
};

/**
 * Claim marker written to `integrityFailureCode` during the atomic claim
 * phase. A row carrying this marker is already being purged by a worker and
 * must not be selected by a second concurrent worker.
 *
 * The marker is cleared (set to null) when the purge succeeds, or replaced
 * with a retryable failure code when storage deletion fails so the next cron
 * run can re-attempt. A stale claim from a crashed worker is re-claimable
 * after {@link CLAIM_TIMEOUT_MS}.
 */
const PURGE_CLAIM_MARKER = "RETENTION_PURGE_CLAIMED";
const PURGE_CLAIMED_FAIL_CODE = "RETENTION_BYTES_DELETED_PENDING_ROW_PURGE";
const STORAGE_DELETE_FAILED_CODE = "RETENTION_STORAGE_DELETE_FAILED";
const ROW_PURGE_FAILED_CODE = "RETENTION_ROW_PURGE_FAILED";

/** A claim older than this is considered stale (worker crashed) and can be re-claimed. */
const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

async function deleteStoredBytes(
  storage: StorageAdapter,
  record: {
    storagePath?: string | null;
    fileContent?: string | null;
    fileName: string;
  },
): Promise<boolean> {
  if (!record.storagePath && !record.fileContent) return false;
  await storage.deleteFile(record);
  return true;
}

/**
 * Build the conditional WHERE for an atomic claim. A row is claimable when it
 * is not currently claimed, OR its claim is older than the stale-claim
 * threshold (the prior worker crashed mid-purge).
 */
function claimWhere(file: { id: string }, cutoff: Date, now: Date) {
  const staleClaimCutoff = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  return {
    id: file.id,
    deletionStatus: "DELETED" as const,
    deletedAt: { not: null, lt: cutoff },
    OR: [
      { integrityFailureCode: { not: PURGE_CLAIM_MARKER } },
      { integrityVerifiedAt: { lt: staleClaimCutoff } },
    ],
  };
}

/**
 * Purge old soft-deleted tender files without losing the only retry pointer.
 * Each candidate is atomically claimed before any storage or row mutation so
 * two concurrent cron workers cannot double-delete storage or double-count
 * rows. The database row is retained whenever external storage cleanup fails.
 */
export async function purgeExpiredTenderFiles(args: {
  prisma: PrismaClient;
  storage: StorageAdapter;
  cutoff: Date;
  now?: Date;
}): Promise<RetentionCleanupResult> {
  const now = args.now ?? new Date();

  const candidates = await args.prisma.tenderFile.findMany({
    where: {
      deletedAt: { not: null, lt: args.cutoff },
      deletionStatus: "DELETED",
    },
    select: {
      id: true,
      storagePath: true,
      fileContent: true,
      originalFileName: true,
    },
  }) as TenderFileCandidate[];

  let rowsDeleted = 0;
  let blobsCleaned = 0;
  let failures = 0;

  for (const file of candidates) {
    try {
      // ── Phase 1: Atomic claim ────────────────────────────────────────────
      // Set the claim marker conditionally. If another worker already claimed
      // this row (and the claim is fresh), updateMany matches 0 rows and we
      // skip. The original storagePath/fileContent are preserved during the
      // claim so a crashed worker's row can still be retried.
      const claim = await args.prisma.tenderFile.updateMany({
        where: claimWhere(file, args.cutoff, now),
        data: {
          integrityFailureCode: PURGE_CLAIM_MARKER,
          integrityVerifiedAt: now,
        },
      });
      if (claim.count === 0) {
        // Another worker owns this row — skip without side effects.
        continue;
      }

      // ── Phase 2: Storage delete (using the original candidate pointers) ──
      let storageDeleted = false;
      try {
        storageDeleted = await deleteStoredBytes(args.storage, {
          storagePath: file.storagePath,
          fileContent: file.fileContent,
          fileName: file.originalFileName,
        });
        if (storageDeleted) blobsCleaned += 1;
      } catch (storageError) {
        // Release the claim and restore the row for the next cron run. The
        // original storagePath/fileContent were never mutated, so the retry
        // can re-attempt the exact same blob.
        await args.prisma.tenderFile.updateMany({
          where: { id: file.id, deletionStatus: "DELETED" },
          data: {
            integrityFailureCode: STORAGE_DELETE_FAILED_CODE,
            integrityVerifiedAt: now,
            deletionAttempts: { increment: 1 },
            lastDeletionError: STORAGE_DELETE_FAILED_CODE,
          },
        }).catch(() => undefined);
        failures += 1;
        logger.warn("[retention-cleanup] tender file storage delete deferred", {
          fileId: file.id,
          errorClass: storageError instanceof Error ? storageError.constructor.name : "UnknownError",
        });
        continue;
      }

      // ── Phase 3: Clear byte claims and delete the row ────────────────────
      // Storage was cleaned (or there were no bytes to clean). Now it is safe
      // to clear the stale byte pointers and remove the row. If the row
      // delete fails, the retained audit row truthfully says its bytes are
      // gone.
      await args.prisma.tenderFile.updateMany({
        where: {
          id: file.id,
          deletionStatus: "DELETED",
          deletedAt: { not: null, lt: args.cutoff },
        },
        data: {
          storagePath: "",
          fileContent: null,
          integrityStatus: "MISSING",
          integrityVerifiedAt: now,
          integrityFailureCode: PURGE_CLAIMED_FAIL_CODE,
          lastDeletionError: null,
        },
      });
      const deleted = await args.prisma.tenderFile.deleteMany({
        where: {
          id: file.id,
          deletionStatus: "DELETED",
          deletedAt: { not: null, lt: args.cutoff },
        },
      });
      rowsDeleted += deleted.count;
    } catch (error) {
      failures += 1;
      await args.prisma.tenderFile.updateMany({
        where: { id: file.id, deletionStatus: "DELETED" },
        data: {
          integrityFailureCode: ROW_PURGE_FAILED_CODE,
          deletionAttempts: { increment: 1 },
          lastDeletionError: ROW_PURGE_FAILED_CODE,
        },
      }).catch(() => undefined);
      logger.warn("[retention-cleanup] tender file purge deferred", {
        fileId: file.id,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
    }
  }

  return {
    candidates: candidates.length,
    rowsDeleted,
    blobsCleaned,
    failures,
  };
}

/**
 * Purge old SUPERSEDED generated documents. Each candidate is atomically
 * claimed before any storage or row mutation so two concurrent cron workers
 * cannot double-delete storage or double-count rows. Storage must be removed
 * before the database row, otherwise a failed Blob delete becomes permanently
 * orphaned.
 */
export async function purgeExpiredSupersededDocuments(args: {
  prisma: PrismaClient;
  storage: StorageAdapter;
  cutoff: Date;
  now?: Date;
}): Promise<RetentionCleanupResult> {
  const now = args.now ?? new Date();

  const candidates = await args.prisma.generatedDocument.findMany({
    where: {
      generationStatus: "SUPERSEDED",
      updatedAt: { lt: args.cutoff },
    },
    select: {
      id: true,
      storagePath: true,
      fileContent: true,
      exactFileName: true,
    },
  }) as GeneratedDocumentCandidate[];

  let rowsDeleted = 0;
  let blobsCleaned = 0;
  let failures = 0;

  for (const doc of candidates) {
    try {
      // ── Phase 1: Atomic claim ────────────────────────────────────────────
      const staleClaimCutoff = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
      const claim = await args.prisma.generatedDocument.updateMany({
        where: {
          id: doc.id,
          generationStatus: "SUPERSEDED",
          updatedAt: { lt: args.cutoff },
          OR: [
            { integrityFailureCode: { not: PURGE_CLAIM_MARKER } },
            { integrityVerifiedAt: { lt: staleClaimCutoff } },
          ],
        },
        data: {
          integrityFailureCode: PURGE_CLAIM_MARKER,
          integrityVerifiedAt: now,
        },
      });
      if (claim.count === 0) {
        continue;
      }

      // ── Phase 2: Storage delete ──────────────────────────────────────────
      let storageDeleted = false;
      try {
        storageDeleted = await deleteStoredBytes(args.storage, {
          storagePath: doc.storagePath,
          fileContent: doc.fileContent,
          fileName: doc.exactFileName ?? doc.id,
        });
        if (storageDeleted) blobsCleaned += 1;
      } catch (storageError) {
        await args.prisma.generatedDocument.updateMany({
          where: { id: doc.id, generationStatus: "SUPERSEDED" },
          data: {
            integrityFailureCode: STORAGE_DELETE_FAILED_CODE,
            integrityVerifiedAt: now,
          },
        }).catch(() => undefined);
        failures += 1;
        logger.warn("[retention-cleanup] superseded document storage delete deferred", {
          documentId: doc.id,
          errorClass: storageError instanceof Error ? storageError.constructor.name : "UnknownError",
        });
        continue;
      }

      // ── Phase 3: Clear byte claims and delete the row ────────────────────
      await args.prisma.generatedDocument.updateMany({
        where: { id: doc.id, generationStatus: "SUPERSEDED" },
        data: {
          storagePath: null,
          fileContent: null,
          integrityStatus: "MISSING",
          integrityVerifiedAt: now,
          integrityFailureCode: PURGE_CLAIMED_FAIL_CODE,
        },
      });
      const deleted = await args.prisma.generatedDocument.deleteMany({
        where: { id: doc.id, generationStatus: "SUPERSEDED" },
      });
      rowsDeleted += deleted.count;
    } catch (error) {
      failures += 1;
      await args.prisma.generatedDocument.updateMany({
        where: { id: doc.id, generationStatus: "SUPERSEDED" },
        data: {
          integrityFailureCode: ROW_PURGE_FAILED_CODE,
        },
      }).catch(() => undefined);
      logger.warn("[retention-cleanup] superseded document purge deferred", {
        documentId: doc.id,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
    }
  }

  return {
    candidates: candidates.length,
    rowsDeleted,
    blobsCleaned,
    failures,
  };
}
