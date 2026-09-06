import { PrismaClient } from "@prisma/client";
import { getStorageAdapter } from "../../storage";
import { invalidateTenderForSourceRevision } from "../source-revision-invalidation";

export type DurableTenderFileDeletionResult = {
  success: true;
  fileName: string;
  storageCleanupPending: boolean;
  alreadyDeleted?: boolean;
};

const STORAGE_DELETE_ATTEMPTS = 3;

async function deleteStoredFileWithRetry(record: {
  storagePath: string;
  fileContent: string | null;
  originalFileName: string;
}): Promise<boolean> {
  for (let attempt = 1; attempt <= STORAGE_DELETE_ATTEMPTS; attempt += 1) {
    try {
      await getStorageAdapter().deleteFile({
        storagePath: record.storagePath,
        fileContent: record.fileContent,
        fileName: record.originalFileName,
      });
      return true;
    } catch {
      if (attempt < STORAGE_DELETE_ATTEMPTS) {
        await new Promise<void>((resolve) => setTimeout(resolve, 75 * attempt));
      }
    }
  }
  return false;
}

export async function durableDeleteTenderFile(
  prisma: PrismaClient,
  fileId: string,
  tenderId: string,
  userId: string,
): Promise<DurableTenderFileDeletionResult> {
  const file = await prisma.tenderFile.findFirst({
    where: {
      id: fileId,
      tenderId,
      tender: { userId },
    },
  });
  if (!file) throw new Error("FILE_NOT_FOUND_OR_UNAUTHORIZED");

  if (file.deletionStatus === "DELETED") {
    return {
      success: true,
      fileName: file.originalFileName,
      storageCleanupPending: false,
      alreadyDeleted: true,
    };
  }
  if (!['ACTIVE', 'PENDING_DELETE'].includes(file.deletionStatus)) {
    throw new Error("FILE_DELETION_STATE_INVALID");
  }

  if (file.deletionStatus === "ACTIVE") {
    // First transaction: make the source inactive, invalidate every dependent
    // release artifact, and remove all live source-grounding pointers. The row
    // remains for audit history. contentHash is a legacy dedup key, not the
    // trust digest; clear it as soon as the row leaves ACTIVE so re-uploading
    // the same verified bytes is not blocked. contentSha256 remains preserved.
    await prisma.$transaction(async (tx) => {
      await invalidateTenderForSourceRevision(tx, tenderId, "SOURCE_FILE_DELETED");

      await tx.tenderRequirement.updateMany({
        where: { tenderId, sourceTenderFileId: fileId },
        data: {
          sourceTenderFileId: null,
          sourcePageNumber: null,
          sourceExactQuote: null,
          sourceConfidence: 0,
          sourceExtractionMethod: "stale:source_file_deleted",
        },
      });

      const sourceFields = [
        ["titleSourceFileId", { titleSourceFileId: null, titleSourcePage: null, titleSourceQuote: null }],
        ["clientNameSourceFileId", { clientNameSourceFileId: null, clientNameSourcePage: null, clientNameSourceQuote: null }],
        ["deadlineSourceFileId", { deadlineSourceFileId: null, deadlineSourcePage: null, deadlineSourceQuote: null }],
        ["referenceSourceFileId", { referenceSourceFileId: null, referenceSourcePage: null, referenceSourceQuote: null }],
        ["submissionMethodSourceFileId", { submissionMethodSourceFileId: null, submissionMethodSourcePage: null, submissionMethodSourceQuote: null }],
        ["submissionAddressSourceFileId", { submissionAddressSourceFileId: null, submissionAddressSourcePage: null, submissionAddressSourceQuote: null }],
        ["submissionEmailSourceFileId", { submissionEmailSourceFileId: null, submissionEmailSourcePage: null, submissionEmailSourceQuote: null }],
        ["submissionEmailSubjectSourceFileId", { submissionEmailSubjectSourceFileId: null, submissionEmailSubjectSourcePage: null, submissionEmailSubjectSourceQuote: null }],
      ] as const;

      for (const [field, data] of sourceFields) {
        await tx.tender.updateMany({
          where: { id: tenderId, [field]: fileId },
          data,
        });
      }

      await tx.tenderFactsLedger.updateMany({
        where: { tenderId, sourceFileId: fileId },
        data: {
          sourceFileId: null,
          sourcePage: null,
          sourceQuote: null,
          sourceStatus: "stale",
          reviewState: "pending",
        },
      });
      await tx.tenderSubmissionEmail.updateMany({
        where: { tenderId, sourceFileId: fileId },
        data: { sourceFileId: null, sourcePage: null, sourceQuote: null },
      });
      await tx.extractionQualityOverride.deleteMany({
        where: { tenderId, tenderFileId: fileId },
      });
      await tx.tenderFile.update({
        where: { id: fileId },
        data: {
          deletionStatus: "PENDING_DELETE",
          contentHash: null,
          lastDeletionError: null,
        },
      });
    });
  } else {
    // Recover rows left in PENDING_DELETE by an interrupted or failed external
    // storage call. Clearing the legacy dedup key also repairs older stuck rows
    // created before this recovery behavior existed.
    await prisma.tenderFile.update({
      where: { id: fileId },
      data: {
        contentHash: null,
        lastDeletionError: null,
      },
    });
  }

  const storageDeleted = await deleteStoredFileWithRetry(file);
  if (!storageDeleted) {
    // Keep the source inactive and its bytes/pointer available for a later
    // idempotent retry. Returning a pending state avoids falsely reactivating a
    // source whose grounding was already invalidated and prevents repeated 502s.
    await prisma.tenderFile.update({
      where: { id: fileId },
      data: {
        deletionStatus: "PENDING_DELETE",
        deletionAttempts: { increment: 1 },
        lastDeletionError: "STORAGE_DELETION_PENDING",
      },
    });
    return {
      success: true,
      fileName: file.originalFileName,
      storageCleanupPending: true,
    };
  }

  // Preserve the source row as immutable deletion history. Bytes and live
  // storage pointers are cleared only after storage deletion succeeds.
  await prisma.tenderFile.update({
    where: { id: fileId },
    data: {
      deletionStatus: "DELETED",
      deletedAt: new Date(),
      storagePath: "",
      fileContent: null,
      contentHash: null,
      integrityStatus: "MISSING",
      integrityVerifiedAt: new Date(),
      integrityFailureCode: "SOURCE_FILE_DELETED",
      deletionAttempts: { increment: 1 },
      lastDeletionError: null,
    },
  });

  return {
    success: true,
    fileName: file.originalFileName,
    storageCleanupPending: false,
  };
}
