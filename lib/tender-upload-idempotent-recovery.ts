import { NextResponse } from "next/server";
import { requireRole } from "./auth";
import { prisma, prismaReady } from "./prisma";
import { validateUploadBatch, validateUploadFile } from "./upload-security";
import { inspectActualFileBytes } from "./engine/persisted-byte-integrity";
import { getStorageAdapter } from "./storage";
import { getFileTypeLabel } from "./extract-text";
import { invalidateTenderForSourceRevision } from "./engine/source-revision-invalidation";
import { enqueueTenderFileExtractionJob } from "./ai-jobs/tender-extraction-service";
import { logAction } from "./audit";
import { logger } from "./observability";
import { withPrismaWriteConflictRetry } from "./prisma-write-conflict-retry";

const tenderFileSelect = {
  id: true,
  tenderId: true,
  fileName: true,
  originalFileName: true,
  mimeType: true,
  size: true,
  classification: true,
  integrityStatus: true,
  contentSha256: true,
  contentByteLength: true,
  detectedFormat: true,
  createdAt: true,
} as const;

/**
 * Recover the narrow race where /api/upload stored valid bytes but the
 * TenderFile insert lost to the unique (tenderId, contentHash) constraint.
 *
 * ACTIVE rows are returned as an idempotent replay. DELETED audit rows are
 * restored in place with newly persisted, re-verified bytes so the immutable
 * content key remains unique. No unsupported or mismatched file is accepted.
 */
export async function recoverIdempotentTenderUpload(
  req: Request,
  failedResponse: Response,
): Promise<Response | null> {
  if (failedResponse.status !== 422) return null;

  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch {
    return null;
  }

  const formData = await req.formData().catch(() => null);
  if (!formData || formData.get("companyDoc") === "true") return null;

  const tenderValue = formData.get("tenderId");
  const tenderId = typeof tenderValue === "string" && tenderValue ? tenderValue : null;
  const files = formData.getAll("file").filter((entry): entry is File => entry instanceof File);
  if (!tenderId || files.length !== 1 || validateUploadBatch(files)) return null;

  const file = files[0];
  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = await validateUploadFile(file, buffer);
  if (!validation.ok) return null;

  const integrity = inspectActualFileBytes({
    bytes: buffer,
    filename: validation.safeFileName,
    claimedMimeType: validation.normalizedMime,
  });
  const contentHash = integrity.contentSha256;
  if (integrity.integrityStatus !== "VERIFIED" || !contentHash) return null;

  await prismaReady;
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    select: { id: true },
  });
  if (!tender) return null;

  const existing = await prisma.tenderFile.findFirst({
    where: { tenderId, contentHash },
    select: {
      ...tenderFileSelect,
      deletionStatus: true,
      extractedText: true,
    },
  });
  if (!existing) return null;

  if (existing.deletionStatus === "PENDING_DELETE") {
    return NextResponse.json(
      {
        error: "The previous copy is still being deleted. Retry after deletion completes.",
        code: "FILE_DELETE_PENDING",
      },
      { status: 409 },
    );
  }

  const deferAnalysis = formData.get("deferAnalysis") === "true";
  let fileRecord = existing;
  let restored = false;

  if (existing.deletionStatus === "DELETED") {
    const storage = getStorageAdapter();
    const stored = await storage.putFile(buffer, {
      fileName: validation.safeFileName,
      mimeType: validation.normalizedMime,
      companyId: undefined,
      tenderId,
    });

    try {
      const classificationValue = formData.get("classification");
      const classification = typeof classificationValue === "string" ? classificationValue : null;
      fileRecord = await withPrismaWriteConflictRetry(() => prisma.$transaction(async (tx) => {
        const current = await tx.tenderFile.findFirst({
          where: { id: existing.id, tenderId },
          select: { deletionStatus: true },
        });
        if (!current) throw new Error("TENDER_FILE_DISAPPEARED");

        if (current.deletionStatus === "ACTIVE") {
          return tx.tenderFile.findUniqueOrThrow({
            where: { id: existing.id },
            select: tenderFileSelect,
          });
        }
        if (current.deletionStatus === "PENDING_DELETE") {
          throw new Error("FILE_DELETE_PENDING");
        }

        const updated = await tx.tenderFile.update({
          where: { id: existing.id },
          data: {
            fileName: validation.safeFileName,
            originalFileName: validation.safeFileName,
            mimeType: validation.normalizedMime,
            size: buffer.byteLength,
            storagePath: stored.storagePath,
            fileContent: stored.fileContent ?? null,
            ...integrity,
            classification,
            extractedText: null,
            totalPages: null,
            extractedPages: null,
            ocrPages: null,
            failedPages: null,
            extractionScore: null,
            extractionMethod: null,
            pageStatusJson: null,
            ocrModel: null,
            contentHash,
            deletionStatus: "ACTIVE",
            deletedAt: null,
            lastDeletionError: null,
          },
          select: tenderFileSelect,
        });
        await invalidateTenderForSourceRevision(tx, tenderId, "SOURCE_FILE_ADDED");
        return updated;
      }));
      restored = true;
    } catch (error) {
      await storage.deleteFile({
        storagePath: stored.storagePath,
        fileContent: stored.fileContent,
        fileName: validation.safeFileName,
      }).catch(() => undefined);
      if (error instanceof Error && error.message === "FILE_DELETE_PENDING") {
        return NextResponse.json(
          { error: "The previous copy is still being deleted. Retry after deletion completes.", code: "FILE_DELETE_PENDING" },
          { status: 409 },
        );
      }
      throw error;
    }
  }

  let processingJobId: string | null = null;
  if (fileRecord.contentSha256) {
    const extractionJob = await enqueueTenderFileExtractionJob(prisma, {
      userId: actor.id,
      companyId: undefined,
      tenderId,
      tenderFileId: fileRecord.id,
      sourceContentSha256: fileRecord.contentSha256,
      intakeSessionId: null,
      deferAnalysis,
    }).catch((error) => {
      logger.warn("[upload-idempotent-recovery] extraction enqueue failed", {
        tenderId,
        fileId: fileRecord.id,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
      return null;
    });
    processingJobId = extractionJob?.id ?? null;
  }

  if (restored) {
    void logAction({
      userId: actor.id,
      action: "TENDER_FILE_RESTORED",
      entityType: "TenderFile",
      entityId: fileRecord.id,
      description: "Restored a previously deleted tender source from newly verified uploaded bytes",
      metadata: { tenderId, contentHash },
    }).catch(() => undefined);
  }

  return NextResponse.json({
    success: true,
    replayed: !restored,
    restored,
    uploaded: 1,
    errors: 0,
    results: [{
      success: true,
      scope: "tender",
      replayed: !restored,
      restored,
      fileRecord,
      extraction: { fileType: getFileTypeLabel(validation.normalizedMime, validation.safeFileName), extractionStatus: processingJobId ? "QUEUED" : "PENDING" },
    }],
    processingJobId,
    analysisRevision: null,
    pipelineStage: processingJobId ? "EXTRACT_TEXT_QUEUED" : null,
    pipelineDeferred: deferAnalysis,
    intakeSessionId: null,
    intakeSession: null,
    engineQueued: false,
    companyImport: null,
  }, { status: processingJobId ? 202 : 200 });
}
