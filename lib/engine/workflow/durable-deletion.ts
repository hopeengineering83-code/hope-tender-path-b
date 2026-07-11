import { PrismaClient } from "@prisma/client";
import { getStorageAdapter } from "../../storage";
import { invalidateTenderForSourceRevision } from "../source-revision-invalidation";

export async function durableDeleteTenderFile(
  prisma: PrismaClient,
  fileId: string,
  tenderId: string,
  userId: string,
) {
  const file = await prisma.tenderFile.findFirst({
    where: {
      id: fileId,
      tenderId,
      deletionStatus: "ACTIVE",
      tender: { userId },
    },
  });
  if (!file) throw new Error("FILE_NOT_FOUND_OR_UNAUTHORIZED");

  // First transaction: make the source inactive, invalidate every dependent
  // release artifact, and remove all live source-grounding pointers. The row
  // remains for audit history.
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
        lastDeletionError: null,
      },
    });
  });

  try {
    await getStorageAdapter().deleteFile({
      storagePath: file.storagePath,
      fileContent: file.fileContent,
      fileName: file.originalFileName,
    });
  } catch {
    await prisma.tenderFile.update({
      where: { id: fileId },
      data: {
        deletionStatus: "ACTIVE",
        deletionAttempts: { increment: 1 },
        lastDeletionError: "STORAGE_DELETION_FAILED",
      },
    }).catch(() => undefined);
    throw new Error("STORAGE_DELETION_FAILED");
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
      integrityStatus: "MISSING",
      integrityVerifiedAt: new Date(),
      integrityFailureCode: "SOURCE_FILE_DELETED",
      deletionAttempts: { increment: 1 },
      lastDeletionError: null,
    },
  });

  return { success: true, fileName: file.originalFileName };
}
