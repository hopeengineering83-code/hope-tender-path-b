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
 * Purge old soft-deleted tender files without losing the only retry pointer.
 * The database row is retained whenever external storage cleanup fails.
 */
export async function purgeExpiredTenderFiles(args: {
  prisma: PrismaClient;
  storage: StorageAdapter;
  cutoff: Date;
}): Promise<RetentionCleanupResult> {
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
      const cleaned = await deleteStoredBytes(args.storage, {
        storagePath: file.storagePath,
        fileContent: file.fileContent,
        fileName: file.originalFileName,
      });
      if (cleaned) blobsCleaned += 1;

      // Clear stale byte claims before final row removal. If the final delete
      // fails, the retained audit row truthfully says its bytes are gone.
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
          integrityVerifiedAt: new Date(),
          integrityFailureCode: "RETENTION_BYTES_DELETED_PENDING_ROW_PURGE",
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
          deletionAttempts: { increment: 1 },
          lastDeletionError: "RETENTION_STORAGE_OR_ROW_PURGE_FAILED",
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
 * Purge old SUPERSEDED generated documents. Storage must be removed before the
 * database row, otherwise a failed Blob delete becomes permanently orphaned.
 */
export async function purgeExpiredSupersededDocuments(args: {
  prisma: PrismaClient;
  storage: StorageAdapter;
  cutoff: Date;
}): Promise<RetentionCleanupResult> {
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
      const cleaned = await deleteStoredBytes(args.storage, {
        storagePath: doc.storagePath,
        fileContent: doc.fileContent,
        fileName: doc.exactFileName ?? doc.id,
      });
      if (cleaned) blobsCleaned += 1;

      await args.prisma.generatedDocument.updateMany({
        where: { id: doc.id, generationStatus: "SUPERSEDED" },
        data: {
          storagePath: null,
          fileContent: null,
          integrityStatus: "MISSING",
          integrityVerifiedAt: new Date(),
          integrityFailureCode: "RETENTION_BYTES_DELETED_PENDING_ROW_PURGE",
        },
      });
      const deleted = await args.prisma.generatedDocument.deleteMany({
        where: { id: doc.id, generationStatus: "SUPERSEDED" },
      });
      rowsDeleted += deleted.count;
    } catch (error) {
      failures += 1;
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
