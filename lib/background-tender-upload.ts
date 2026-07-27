import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireRole } from "./auth";
import { logAction } from "./audit";
import { enqueueTenderFileExtractionJob } from "./ai-jobs/tender-extraction-service";
import { ensureCompanyForUser } from "./company-workspace";
import { inspectActualFileBytes, type PersistedByteIntegrity } from "./engine/persisted-byte-integrity";
import { logger, reportError } from "./observability";
import { prisma, prismaReady } from "./prisma";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "./rate-limit";
import { extractRequestId } from "./request-id";
import { getStorageAdapter, type StorageProvider } from "./storage";
import {
  fingerprintTenderPackageBatch,
  initialTenderPackageSessionResult,
  packageBatchKey,
  packageSessionJson,
  parseTenderPackageIntake,
  parseTenderPackageSessionResult,
  TENDER_PACKAGE_BATCH_OPERATION,
  TENDER_PACKAGE_INTAKE_OPERATION,
} from "./tender-package-intake-session";
import { validateUploadBatch, validateUploadFile } from "./upload-security";

export const BACKGROUND_TENDER_UPLOAD_HANDLER = "BACKGROUND_TENDER_UPLOAD_V1";

type StoredTenderUpload = {
  originalFileName: string;
  mimeType: string;
  size: number;
  storagePath: string;
  fileContent: string | null;
  storageProvider: StorageProvider;
  integrity: PersistedByteIntegrity & { contentSha256: string };
};

function titleFromFileName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return stem.slice(0, 180) || "Uploaded Tender";
}

async function cleanupStoredUploads(uploads: StoredTenderUpload[]): Promise<void> {
  const storage = getStorageAdapter();
  await Promise.allSettled(uploads.map((upload) => storage.deleteFile({
    storagePath: upload.storagePath,
    fileContent: upload.fileContent,
    fileName: upload.originalFileName,
  })));
}

export async function handleUploadFirstTender(req: Request): Promise<NextResponse> {
  const requestId = extractRequestId(req);
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch {
    return NextResponse.json({ error: "Forbidden", code: "UPLOAD_FORBIDDEN", requestId }, { status: 403 });
  }

  const rate = await rateLimitPersistent(`upload-first:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rate.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many upload requests", code: "UPLOAD_RATE_LIMITED", retryAfter, requestId },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  await prismaReady;
  const storedUploads: StoredTenderUpload[] = [];
  let committed = false;

  try {
    const form = await req.formData();
    const files = form.getAll("file").filter((entry): entry is File => entry instanceof File);
    const deferAnalysis = form.get("deferAnalysis") === "true";
    const batchError = validateUploadBatch(files);
    if (batchError) {
      return NextResponse.json({ error: batchError, code: "UPLOAD_BATCH_INVALID", errors: [batchError], requestId }, { status: 400 });
    }

    const intakeParse = parseTenderPackageIntake(form, files);
    if (!intakeParse.ok) {
      return NextResponse.json({ error: intakeParse.error, code: intakeParse.code, errors: [intakeParse.error], requestId }, { status: 400 });
    }
    const intake = intakeParse.descriptor;
    if (intake && intake.batchIndex !== 0) {
      return NextResponse.json({
        error: "The first tender upload must be package batch 0.",
        code: "INTAKE_FIRST_BATCH_INVALID",
        requestId,
      }, { status: 400 });
    }
    if (deferAnalysis && !intake) {
      return NextResponse.json({
        error: "Deferred analysis requires a durable tender package session.",
        code: "INTAKE_SESSION_REQUIRED",
        requestId,
      }, { status: 400 });
    }

    const company = await ensureCompanyForUser(prisma, actor.id);
    const batchFingerprint = intake ? await fingerprintTenderPackageBatch(files) : null;

    if (intake && batchFingerprint) {
      const existingSessionRow = await prisma.tenderWorkflowRun.findFirst({
        where: {
          companyId: company.id,
          operation: TENDER_PACKAGE_INTAKE_OPERATION,
          idempotencyKey: intake.sessionId,
        },
      });
      if (existingSessionRow) {
        const existingSession = parseTenderPackageSessionResult(existingSessionRow.resultJson);
        const existingBatch = await prisma.tenderWorkflowRun.findUnique({
          where: {
            companyId_tenderId_operation_idempotencyKey: {
              companyId: company.id,
              tenderId: existingSessionRow.tenderId,
              operation: TENDER_PACKAGE_BATCH_OPERATION,
              idempotencyKey: packageBatchKey(intake.sessionId, 0),
            },
          },
        });
        const ownedTender = await prisma.tender.findFirst({
          where: { id: existingSessionRow.tenderId, userId: actor.id },
          select: { id: true, title: true },
        });
        if (
          !existingSession ||
          !ownedTender ||
          existingSessionRow.inputHash !== intake.manifestHash ||
          existingBatch?.inputHash !== batchFingerprint
        ) {
          return NextResponse.json({
            error: "This tender package session identifier conflicts with an existing intake.",
            code: "INTAKE_SESSION_CONFLICT",
            requestId,
          }, { status: 409 });
        }
        if (existingBatch.status !== "SUCCEEDED") {
          return NextResponse.json({
            error: "The first package batch is already being reconciled. Open the existing tender and resume the missing files.",
            code: "INTAKE_FIRST_BATCH_IN_PROGRESS",
            tenderId: ownedTender.id,
            requestId,
          }, { status: 409 });
        }
        const extractionJobs = await prisma.aiJob.findMany({
          where: { tenderId: ownedTender.id, userId: actor.id, jobType: "EXTRACT_TEXT" },
          orderBy: { createdAt: "asc" },
          select: { id: true, status: true, runId: true },
        });
        return NextResponse.json({
          success: true,
          replayed: true,
          tenderId: ownedTender.id,
          tender: ownedTender,
          uploadedFiles: intake.manifest[0].length,
          extractedFiles: 0,
          extractionJobs,
          processingJobId: existingSession.analysisJobId,
          analysisRevision: existingSession.analysisRevision,
          pipelineStage: existingSession.analysisJobId ? "AI_ANALYZE_QUEUED" : "SOURCE_EXTRACTION_QUEUED",
          pipelineDeferred: existingSession.missingBatchIndexes.length > 0,
          intakeSessionId: intake.sessionId,
          intakeSession: existingSession,
          nextAction: existingSession.missingBatchIndexes.length > 0
            ? "UPLOAD_REMAINING_SOURCE_FILES"
            : existingSession.analysisJobId
              ? "WAIT_FOR_AI_ANALYZE"
              : "WAIT_FOR_SOURCE_EXTRACTION",
          message: "The existing tender package intake was recovered without creating a duplicate tender.",
          requestId,
        }, { status: 200 });
      }
    }

    const tenderId = crypto.randomUUID();
    const storage = getStorageAdapter();
    const errors: string[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const validation = await validateUploadFile(file, buffer);
      if (!validation.ok) {
        errors.push(`${validation.safeFileName}: ${validation.error ?? "File validation failed"}`);
        continue;
      }

      const integrity = inspectActualFileBytes({
        bytes: buffer,
        filename: validation.safeFileName,
        claimedMimeType: validation.normalizedMime,
      });
      if (integrity.integrityStatus !== "VERIFIED" || !integrity.contentSha256) {
        errors.push(`${validation.safeFileName}: file byte integrity verification failed.`);
        continue;
      }

      try {
        const stored = await storage.putFile(buffer, {
          fileName: validation.safeFileName,
          mimeType: validation.normalizedMime,
          companyId: company.id,
          tenderId,
        });
        storedUploads.push({
          originalFileName: validation.safeFileName,
          mimeType: validation.normalizedMime,
          size: buffer.byteLength,
          storagePath: stored.storagePath,
          fileContent: stored.fileContent ?? null,
          storageProvider: stored.provider,
          integrity: { ...integrity, contentSha256: integrity.contentSha256 },
        });
      } catch (storageError) {
        logger.error("[upload-first] source storage failed", {
          requestId,
          fileName: validation.safeFileName,
          errorClass: storageError instanceof Error ? storageError.constructor.name : "UnknownError",
        });
        errors.push(`${validation.safeFileName}: secure storage is temporarily unavailable.`);
      }
    }

    if (errors.length > 0 || storedUploads.length !== files.length) {
      await cleanupStoredUploads(storedUploads);
      storedUploads.length = 0;
      return NextResponse.json({
        success: false,
        error: "Tender intake was not created because one or more source files failed validation or storage.",
        code: "TENDER_SOURCE_UPLOAD_FAILED",
        errors,
        requestId,
      }, { status: 422 });
    }

    const titleOverride = String(form.get("title") ?? "").trim();
    const referenceOverride = String(form.get("reference") ?? "").trim();
    const initialTitle = titleOverride || titleFromFileName(storedUploads[0]?.originalFileName ?? "uploaded-tender");

    const persisted = await prisma.$transaction(async (tx) => {
      const tender = await tx.tender.create({
        data: {
          id: tenderId,
          title: initialTitle,
          reference: referenceOverride || null,
          notes: `Created from ${storedUploads.length} byte-verified tender source file(s). Background extraction is queued.`,
          status: "DRAFT",
          stage: "TENDER_INTAKE",
          userId: actor.id,
        },
        select: { id: true, title: true, reference: true, status: true, stage: true },
      });

      const fileRecords: Array<{
        id: string;
        originalFileName: string;
        contentSha256: string;
        extractionJobId: string;
        extractionJobStatus: string;
        extractionJobReused: boolean;
      }> = [];
      for (const upload of storedUploads) {
        const fileRecord = await tx.tenderFile.create({
          data: {
            tenderId,
            fileName: upload.originalFileName,
            originalFileName: upload.originalFileName,
            mimeType: upload.mimeType,
            size: upload.size,
            storagePath: upload.storagePath,
            fileContent: upload.fileContent,
            ...upload.integrity,
            classification: "Tender Document",
            extractedText: null,
            contentHash: upload.integrity.contentSha256,
            extractionMethod: null,
          },
          select: { id: true, originalFileName: true, contentSha256: true },
        });
        const extractionJob = await enqueueTenderFileExtractionJob(tx, {
          userId: actor.id,
          companyId: company.id,
          tenderId,
          tenderFileId: fileRecord.id,
          sourceContentSha256: fileRecord.contentSha256!,
          intakeSessionId: intake?.sessionId ?? null,
          deferAnalysis,
        });
        fileRecords.push({
          id: fileRecord.id,
          originalFileName: fileRecord.originalFileName,
          contentSha256: fileRecord.contentSha256!,
          extractionJobId: extractionJob.id,
          extractionJobStatus: extractionJob.status,
          extractionJobReused: extractionJob.reused,
        });
      }

      if (intake && batchFingerprint) {
        const sessionResult = initialTenderPackageSessionResult(intake, fileRecords.length);
        const sessionComplete = intake.expectedBatches === 1;
        await tx.tenderWorkflowRun.create({
          data: {
            companyId: company.id,
            tenderId,
            operation: TENDER_PACKAGE_INTAKE_OPERATION,
            idempotencyKey: intake.sessionId,
            status: sessionComplete ? "SUCCEEDED" : "QUEUED",
            phase: sessionComplete ? "source_package_complete" : "awaiting_batches",
            inputHash: intake.manifestHash,
            resultJson: packageSessionJson(sessionResult),
            startedAt: new Date(),
            finishedAt: sessionComplete ? new Date() : null,
          },
        });
        await tx.tenderWorkflowRun.create({
          data: {
            companyId: company.id,
            tenderId,
            operation: TENDER_PACKAGE_BATCH_OPERATION,
            idempotencyKey: packageBatchKey(intake.sessionId, 0),
            status: "SUCCEEDED",
            phase: "source_files_stored",
            inputHash: batchFingerprint,
            resultJson: {
              batchIndex: 0,
              fileCount: fileRecords.length,
              createdFileIds: fileRecords.map((file) => file.id),
            },
            startedAt: new Date(),
            finishedAt: new Date(),
          },
        });
      }

      return { tender, fileRecords };
    }, { timeout: 30_000 });
    committed = true;

    await Promise.allSettled(persisted.fileRecords.map((fileRecord) => {
      const upload = storedUploads.find((item) => item.originalFileName === fileRecord.originalFileName);
      return logAction({
        userId: actor.id,
        action: "TENDER_FILE_UPLOAD",
        entityType: "TenderFile",
        entityId: fileRecord.id,
        description: "Upload-first intake stored verified source bytes and queued durable extraction.",
        metadata: {
          tenderId,
          fileName: fileRecord.originalFileName,
          storageProvider: upload?.storageProvider ?? null,
          sourceContentSha256: fileRecord.contentSha256,
          extractionJobId: fileRecord.extractionJobId,
        },
        requestId,
      });
    }));

    const sourcePackageComplete = !intake || intake.expectedBatches === 1;
    return NextResponse.json({
      success: true,
      tenderId,
      tender: persisted.tender,
      uploadedFiles: storedUploads.length,
      extractedFiles: 0,
      extractionJobs: persisted.fileRecords.map((file) => ({
        id: file.extractionJobId,
        status: file.extractionJobStatus,
        reused: file.extractionJobReused,
        fileId: file.id,
      })),
      warnings: [],
      errors: [],
      engineSkipped: true,
      engineError: null,
      processingJobId: null,
      analysisRevision: null,
      pipelineStage: "SOURCE_EXTRACTION_QUEUED",
      pipelineDeferred: !sourcePackageComplete || deferAnalysis,
      pipelineWarning: null,
      intakeSessionId: intake?.sessionId ?? null,
      intakeSession: intake ? initialTenderPackageSessionResult(intake, storedUploads.length) : null,
      nextAction: sourcePackageComplete ? "WAIT_FOR_SOURCE_EXTRACTION" : "UPLOAD_REMAINING_SOURCE_FILES",
      message: sourcePackageComplete
        ? "Tender and verified source files were created. Durable background extraction is queued."
        : "Tender and the first verified source batch were created. Upload the remaining package batches while extraction runs in the background.",
      requestId,
    }, { status: 201 });
  } catch (error) {
    if (!committed && storedUploads.length > 0) await cleanupStoredUploads(storedUploads);
    logger.error("[upload-first tender] failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    void reportError(error, { route: "/api/tenders/upload-first", requestId });
    return NextResponse.json({
      success: false,
      error: "Tender intake could not be completed. Retry the upload or contact support with the request ID.",
      code: "TENDER_INTAKE_FAILED",
      requestId,
    }, { status: 500 });
  }
}
