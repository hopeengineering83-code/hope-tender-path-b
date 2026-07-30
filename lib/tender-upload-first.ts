import crypto from "crypto";
import { inspectActualFileBytes, type PersistedByteIntegrity } from "./engine/persisted-byte-integrity";
import { NextResponse } from "next/server";
import { requireRole } from "./auth";
import { logAction } from "./audit";
import { ensureCompanyForUser } from "./company-workspace";
import { getFileTypeLabel } from "./extract-text";
import { inferTenderMetadata } from "./engine/tender-metadata";
import {
  continueTenderPipelineAfterExtraction,
  enqueueTenderFileExtractionJob,
} from "./ai-jobs/tender-extraction-service";
import { reportError, logger } from "./observability";
import { prisma, prismaReady } from "./prisma";
import { enqueueAiAnalyzeServerSide } from "./engine/server-side-ai-enqueue";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "./rate-limit";
import { extractRequestId } from "./request-id";
import { getStorageAdapter, type StorageProvider } from "./storage";
import { validateUploadBatch, validateUploadFile } from "./upload-security";
import {
  TENDER_PACKAGE_BATCH_OPERATION,
  TENDER_PACKAGE_INTAKE_OPERATION,
  fingerprintTenderPackageBatch,
  initialTenderPackageSessionResult,
  packageBatchKey,
  packageSessionJson,
  parseTenderPackageIntake,
  parseTenderPackageSessionResult,
} from "./tender-package-intake-session";

type StoredTenderUpload = {
  originalFileName: string;
  fileName: string;
  mimeType: string;
  size: number;
  storagePath: string;
  fileContent: string | null;
  storageProvider: StorageProvider;
  integrity: PersistedByteIntegrity;
  fileTypeLabel: string;
};

async function cleanupStoredUploads(uploads: StoredTenderUpload[]): Promise<void> {
  const storage = getStorageAdapter();
  await Promise.allSettled(
    uploads.map((upload) => storage.deleteFile({
      storagePath: upload.storagePath,
      fileContent: upload.fileContent,
      fileName: upload.originalFileName,
    })),
  );
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

  let storedUploads: StoredTenderUpload[] = [];
  let sourceRowsPersisted = false;
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

    // Lost-response replay guard: the client creates the package session ID
    // before the first request. If that request committed but its response was
    // lost, return the existing owned tender instead of creating a duplicate.
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
        let replayJobId = existingSession.analysisJobId;
        let replayAnalysisRevision = existingSession.analysisRevision;
        let replayStage: "EXTRACT_TEXT_QUEUED" | "AI_ANALYZE_QUEUED" | null =
          replayJobId ? "AI_ANALYZE_QUEUED" : null;
        if (!replayJobId && existingSession.missingBatchIndexes.length === 0) {
          const continuation = await continueTenderPipelineAfterExtraction({
            userId: actor.id,
            tenderId: ownedTender.id,
            companyId: company.id,
            intakeSessionId: intake.sessionId,
            deferAnalysis,
          }).catch(() => null);
          if (continuation?.queued && continuation.jobId) {
            replayJobId = continuation.jobId;
            replayAnalysisRevision = continuation.analysisRevision ?? null;
            replayStage = "AI_ANALYZE_QUEUED";
          }
        }
        if (!replayJobId) {
          const queuedExtraction = await prisma.aiJob.findFirst({
            where: {
              tenderId: ownedTender.id,
              userId: actor.id,
              jobType: "EXTRACT_TEXT",
              status: { in: ["QUEUED", "RUNNING"] },
            },
            orderBy: { createdAt: "asc" },
            select: { id: true },
          });
          if (queuedExtraction) {
            replayJobId = queuedExtraction.id;
            replayStage = "EXTRACT_TEXT_QUEUED";
          }
        }
        return NextResponse.json({
          success: true,
          replayed: true,
          tenderId: ownedTender.id,
          tender: ownedTender,
          uploadedFiles: intake.manifest[0].length,
          processingJobId: replayJobId,
          analysisRevision: replayAnalysisRevision,
          pipelineStage: replayStage,
          pipelineDeferred: existingSession.missingBatchIndexes.length > 0,
          intakeSessionId: intake.sessionId,
          intakeSession: existingSession,
          nextAction: existingSession.missingBatchIndexes.length > 0
            ? "UPLOAD_REMAINING_SOURCE_FILES"
            : replayStage === "AI_ANALYZE_QUEUED"
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
    const warnings: string[] = [];

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

      let stored: Awaited<ReturnType<typeof storage.putFile>>;
      try {
        stored = await storage.putFile(buffer, {
          fileName: validation.safeFileName,
          mimeType: validation.normalizedMime,
          companyId: company.id,
          tenderId,
        });
      } catch (storageError) {
        logger.error("[upload-first] source storage failed", {
        requestId,
        fileName: validation.safeFileName,
        errorClass: storageError instanceof Error
          ? storageError.constructor.name
          : "UnknownError",
      });
      errors.push(`${validation.safeFileName}: secure storage is temporarily unavailable.`);
        continue;
      }

      storedUploads.push({
        originalFileName: validation.safeFileName,
        fileName: validation.safeFileName,
        mimeType: validation.normalizedMime,
        size: buffer.byteLength,
        storagePath: stored.storagePath,
        fileContent: stored.fileContent ?? null,
        storageProvider: stored.provider,
        integrity,
        fileTypeLabel: getFileTypeLabel(validation.normalizedMime, validation.safeFileName),
      });
    }

    if (errors.length > 0 || storedUploads.length !== files.length) {
      await cleanupStoredUploads(storedUploads);
      storedUploads = [];
      return NextResponse.json({
        success: false,
        error: "Tender intake was not created because one or more source files failed validation or storage.",
        code: "TENDER_SOURCE_UPLOAD_FAILED",
        errors,
        requestId,
      }, { status: 422 });
    }

    if (storedUploads.length === 0) {
      return NextResponse.json({
        success: false,
        error: "No tender source file was safely stored.",
        code: "NO_TENDER_SOURCE_FILES_STORED",
        errors: ["Upload at least one supported tender document."],
        requestId,
      }, { status: 422 });
    }

    // Request time owns only validation, secure byte persistence, and durable
    // job creation. The background extraction worker will fill source-derived
    // metadata after reading the exact verified bytes.
    const metadata = inferTenderMetadata("", storedUploads[0]?.originalFileName ?? "uploaded-tender");
    const titleOverride = String(form.get("title") ?? "").trim();
    const referenceOverride = String(form.get("reference") ?? "").trim();

    const persisted = await prisma.$transaction(async (tx) => {
      const tender = await tx.tender.create({
        data: {
          id: tenderId,
          title: titleOverride || metadata.title,
          description: null,
          reference: referenceOverride || metadata.reference,
          clientName: metadata.clientName,
          procuringEntityName: metadata.procuringEntityName,
          donorAgency: metadata.donorAgency,
          implementingAgency: metadata.implementingAgency,
          clientWebsite: metadata.clientWebsite,
          submissionEmailSubject: metadata.submissionEmailSubject,
          contactDetailsSourceJson: metadata.contactDetailsSource ? JSON.stringify(metadata.contactDetailsSource) : null,
          category: metadata.category,
          country: metadata.country,
          budget: metadata.budget ?? null,
          currency: metadata.currency ?? null,
          deadline: metadata.deadline,
          submissionMethod: metadata.submissionMethod,
          submissionAddress: metadata.submissionAddress,
          intakeSummary: null,
          pageLimit: metadata.pageLimit ?? null,
          clientContactName: metadata.clientContactName,
          clientContactTitle: metadata.clientContactTitle,
          clientContactEmail: metadata.clientContactEmail,
          clientContactPhone: metadata.clientContactPhone,
          clientAddress: metadata.clientAddress,
          submissionEmails: metadata.submissionEmails.length > 0 ? metadata.submissionEmails.join("|") : null,
          validityDays: metadata.validityDays,
          bidBondAmount: metadata.bidBondAmount,
          bidBondCurrency: metadata.bidBondCurrency,
          preBidMeetingDate: metadata.preBidMeetingDate,
          preBidMeetingLocation: metadata.preBidMeetingLocation,
          mandatorySiteVisit: metadata.mandatorySiteVisit,
          numberOfCopiesRequired: metadata.numberOfCopiesRequired,
          technicalWeight: metadata.technicalWeight,
          financialWeight: metadata.financialWeight,
          notes: `Created from ${storedUploads.length} validated tender source file(s). Durable background extraction is queued; source-derived Tender Details remain unavailable until it completes.`,
          status: "DRAFT",
          stage: "TENDER_INTAKE",
          userId: actor.id,
        },
      });

      const fileRecords: Array<{
        id: string;
        originalFileName: string;
        contentSha256: string | null;
      }> = [];
      for (const upload of storedUploads) {
        // Use the SHA-256 digest already pinned from the actual uploaded bytes
        // as the dedup key. contentHash is not a trust digest, but binding it
        // to real bytes makes retry reconciliation stable across storage modes.
        const contentHash = upload.integrity.contentSha256;
        if (!contentHash) throw new Error("VERIFIED_SOURCE_HASH_MISSING");
        fileRecords.push(await tx.tenderFile.create({
          data: {
            tenderId,
            fileName: upload.fileName,
            originalFileName: upload.originalFileName,
            mimeType: upload.mimeType,
            size: upload.size,
            storagePath: upload.storagePath,
            fileContent: upload.fileContent,
            ...upload.integrity,
            classification: "Tender Document",
            extractedText: null,
            contentHash,
            totalPages: null,
            extractedPages: null,
            ocrPages: null,
            failedPages: null,
            extractionScore: null,
            extractionMethod: null,
            pageStatusJson: null,
            ocrModel: null,
          },
          select: { id: true, originalFileName: true, contentSha256: true },
        }));
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

      const extractionJobs = [];
      for (const fileRecord of fileRecords) {
        if (!fileRecord.contentSha256) throw new Error("VERIFIED_SOURCE_HASH_MISSING");
        extractionJobs.push(await enqueueTenderFileExtractionJob(tx, {
          userId: actor.id,
          companyId: company.id,
          tenderId,
          tenderFileId: fileRecord.id,
          sourceContentSha256: fileRecord.contentSha256,
          intakeSessionId: intake?.sessionId ?? null,
          deferAnalysis,
        }));
      }

      return { tender, fileRecords, extractionJobs };
    }, { timeout: 30_000 });
    sourceRowsPersisted = true;

    for (const fileRecord of persisted.fileRecords) {
      const upload = storedUploads.find((item) => item.originalFileName === fileRecord.originalFileName);
      await logAction({
        userId: actor.id,
        action: "TENDER_FILE_UPLOAD",
        entityType: "TenderFile",
        entityId: fileRecord.id,
        description: `Upload-first tender intake stored validated file "${fileRecord.originalFileName}"`,
        metadata: {
          tenderId,
          fileName: fileRecord.originalFileName,
          storageProvider: upload?.storageProvider ?? null,
          extractionStatus: "QUEUED",
          extractionOwner: "EXTRACT_TEXT",
        },
        requestId,
      }).catch((error) => {
        logger.warn("[upload-first] upload audit persistence failed", {
          requestId,
          tenderId,
          fileId: fileRecord.id,
          errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
        });
      });
    }

    const sourcePackageComplete = !intake || intake.expectedBatches === 1;
    const processingJobId = persisted.extractionJobs[0]?.id ?? null;
    const processingStage = processingJobId ? "EXTRACT_TEXT_QUEUED" as const : null;

    return NextResponse.json({
      success: true,
      tenderId,
      tender: persisted.tender,
      uploadedFiles: storedUploads.length,
      extractedFiles: 0,
      queuedExtractionFiles: persisted.extractionJobs.length,
      warnings,
      errors: [],
      engineSkipped: true,
      engineError: null,
      processingJobId,
      analysisRevision: null,
      serverEnqueue: null,
      pipelineStage: processingStage,
      pipelineDeferred: !sourcePackageComplete || deferAnalysis,
      pipelineWarning: processingJobId
        ? null
        : "Tender intake completed, but no extraction job was created. Retry the source upload.",
      intakeSessionId: intake?.sessionId ?? null,
      intakeSession: intake
        ? initialTenderPackageSessionResult(intake, storedUploads.length)
        : null,
      nextAction: !sourcePackageComplete
        ? "UPLOAD_REMAINING_SOURCE_FILES"
        : processingJobId
          ? "WAIT_FOR_SOURCE_EXTRACTION"
          : "RETRY_SOURCE_UPLOAD",
      message: processingJobId
        ? sourcePackageComplete
          ? "Tender and verified source files were created. Durable background extraction is queued; analysis will follow automatically."
          : "Tender and the first verified source batch were created. Extraction is queued; analysis will wait for the remaining package batches."
        : "Tender and verified source files were created, but durable extraction must be retried.",
      requestId,
    }, { status: 201 });
  } catch (error) {
    if (!sourceRowsPersisted && storedUploads.length > 0) await cleanupStoredUploads(storedUploads);
    logger.error(`[upload-first tender] failed (requestId=${requestId}):`, {
      detail: error,
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
