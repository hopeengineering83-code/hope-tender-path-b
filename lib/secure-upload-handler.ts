import { logger } from "./observability";
import { NextResponse } from "next/server";
import { prisma, prismaReady } from "./prisma";
import { requireRole } from "./auth";
import { detectCategoryFromFile, getFileTypeLabel } from "./extract-text";
import { logAction } from "./audit";
import { ensureCompanyForUser } from "./company-workspace";
import { rateLimitPersistent, UPLOAD_RATE_LIMIT } from "./rate-limit";
import { extractRequestId } from "./request-id";
import { getStorageAdapter } from "./storage";
import {
  continueTenderPipelineAfterExtraction,
  enqueueTenderFileExtractionJob,
  type EnqueueTenderExtractionInput,
} from "./ai-jobs/tender-extraction-service";
import { enqueueJob } from "./ai-jobs";
import { validateUploadBatch, validateUploadFile } from "./upload-security";
import { sanitizeError } from "./sanitize-error";
import { inspectActualFileBytes } from "./engine/persisted-byte-integrity";
import { invalidateTenderForSourceRevision } from "./engine/source-revision-invalidation";
import {
  beginTenderPackageBatch,
  completeTenderPackageBatch,
  failTenderPackageBatch,
  fingerprintTenderPackageBatch,
  parseTenderPackageIntake,
  type TenderPackageSessionResult,
} from "./tender-package-intake-session";

export async function handleSecureUpload(req: Request) {
  const requestId = extractRequestId(req);
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rate = await rateLimitPersistent(`upload:${actor.id}`, UPLOAD_RATE_LIMIT);
  if (!rate.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
    return NextResponse.json({ error: "Upload rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  await prismaReady;
  const formData = await req.formData();
  const files = formData.getAll("file").filter((entry): entry is File => entry instanceof File);
  const batchError = validateUploadBatch(files);
  if (batchError) return NextResponse.json({ error: batchError }, { status: 400 });

  const tenderValue = formData.get("tenderId");
  const tenderId = typeof tenderValue === "string" && tenderValue ? tenderValue : null;
  const companyDoc = formData.get("companyDoc") === "true";
  const classificationValue = formData.get("classification");
  const classification = typeof classificationValue === "string" ? classificationValue : null;
  const deferAnalysis = formData.get("deferAnalysis") === "true";
  if (!tenderId && !companyDoc) return NextResponse.json({ error: "tenderId or companyDoc=true is required" }, { status: 400 });
  const intakeParse = parseTenderPackageIntake(formData, files);
  if (!intakeParse.ok) {
    return NextResponse.json({ error: intakeParse.error, code: intakeParse.code }, { status: 400 });
  }
  const intake = intakeParse.descriptor;
  if (intake && (!tenderId || companyDoc)) {
    return NextResponse.json({ error: "Tender package sessions can append only to an existing tender.", code: "INTAKE_TENDER_REQUIRED" }, { status: 400 });
  }

  const company = await ensureCompanyForUser(prisma, actor.id);
  const tender = tenderId
    ? await prisma.tender.findFirst({ where: { id: tenderId, userId: actor.id }, select: { id: true } })
    : null;
  if (tenderId && !tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const batchFingerprint = intake ? await fingerprintTenderPackageBatch(files) : null;
  const packageBatch = intake && tenderId && batchFingerprint
    ? await beginTenderPackageBatch({
        prisma,
        companyId: company.id,
        tenderId,
        descriptor: intake,
        batchFingerprint,
      })
    : null;
  if (packageBatch && !packageBatch.ok) {
    return NextResponse.json({ error: packageBatch.error, code: packageBatch.code }, { status: packageBatch.status });
  }
  if (packageBatch?.ok && packageBatch.replayed) {
    // Upload replay recovers extraction only; manual-ai-analyze is the sole AI authority.
    let replayJobId: string | null = null;
    const replayAnalysisRevision: string | null = null;
    let replayStage: "EXTRACT_TEXT_QUEUED" | null = null;
    if (!replayJobId && tenderId) {
      const queuedExtraction = await prisma.aiJob.findFirst({
        where: {
          tenderId,
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
    const records = tenderId && packageBatch.createdFileIds.length > 0
      ? await prisma.tenderFile.findMany({
          where: {
            tenderId,
            id: { in: packageBatch.createdFileIds },
            deletionStatus: "ACTIVE",
          },
          select: {
            id: true, tenderId: true, fileName: true, originalFileName: true,
            mimeType: true, size: true, classification: true,
            integrityStatus: true, contentSha256: true, contentByteLength: true,
            detectedFormat: true, createdAt: true,
          },
        })
      : [];
    return NextResponse.json({
      success: true,
      replayed: true,
      uploaded: records.length,
      errors: 0,
      results: records.map((fileRecord) => ({ success: true, scope: "tender", replayed: true, fileRecord })),
      processingJobId: replayJobId,
      analysisRevision: replayAnalysisRevision,
      pipelineStage: replayStage,
      pipelineDeferred: packageBatch.session.missingBatchIndexes.length > 0,
      intakeSessionId: intake?.sessionId ?? null,
      intakeSession: packageBatch.session,
      engineQueued: false,
    }, { status: 200 });
  }

  const storage = getStorageAdapter();
  const results: Array<Record<string, unknown>> = [];
  let companyFilesCreated = 0;
  const tenderExtractionInputs: EnqueueTenderExtractionInput[] = [];

  for (const file of files) {
    let stored: Awaited<ReturnType<typeof storage.putFile>> | null = null;
    let sourceRowPersisted = false;
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const validation = await validateUploadFile(file, buffer);
      if (!validation.ok) {
        results.push({ success: false, fileName: validation.safeFileName, error: validation.error });
        continue;
      }

      const fileName = validation.safeFileName;
      const mimeType = validation.normalizedMime;
      const integrity = inspectActualFileBytes({ bytes: buffer, filename: fileName, claimedMimeType: mimeType });
      const contentHash = integrity.contentSha256;
      if (integrity.integrityStatus !== "VERIFIED" || !contentHash) {
        results.push({
          success: false,
          fileName,
          error: "File byte integrity verification failed.",
          code: integrity.integrityFailureCode ?? "FILE_INTEGRITY_NOT_VERIFIED",
        });
        continue;
      }

      // Package retries are byte-idempotent. A prior attempt may have stored
      // some files before its response failed; reuse those active rows instead
      // of creating duplicates, then continue with the missing files.
      if (tenderId && contentHash) {
        const existingFile = await prisma.tenderFile.findFirst({
          where: { tenderId, contentHash, deletionStatus: "ACTIVE" },
          select: {
            id: true, tenderId: true, fileName: true, originalFileName: true,
            mimeType: true, size: true, classification: true,
            integrityStatus: true, contentSha256: true, contentByteLength: true,
            detectedFormat: true, createdAt: true,
          },
        });
        if (existingFile) {
          results.push({ success: true, scope: "tender", replayed: true, fileRecord: existingFile });
          if (existingFile.contentSha256) {
            tenderExtractionInputs.push({
              userId: actor.id,
              companyId: company.id,
              tenderId,
              tenderFileId: existingFile.id,
              sourceContentSha256: existingFile.contentSha256,
              intakeSessionId: intake?.sessionId ?? null,
              deferAnalysis,
            });
          }
          continue;
        }
      }

      const fileType = getFileTypeLabel(mimeType, fileName);

      stored = await storage.putFile(buffer, {
        fileName,
        mimeType,
        companyId: company.id,
        tenderId: tenderId ?? undefined,
      });
      if (!stored) throw new Error("STORAGE_WRITE_DID_NOT_RETURN_A_RECORD");

      if (tenderId) {
        const record = await prisma.$transaction(async (tx) => {
          const created = await tx.tenderFile.create({
            data: {
              tenderId,
              fileName,
              originalFileName: fileName,
              mimeType,
              size: buffer.byteLength,
              storagePath: stored!.storagePath,
              fileContent: stored!.fileContent ?? null,
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
            },
            select: { id: true, tenderId: true, fileName: true, originalFileName: true, mimeType: true, size: true, classification: true, integrityStatus: true, contentSha256: true, contentByteLength: true, detectedFormat: true, createdAt: true },
          });
          await invalidateTenderForSourceRevision(tx, tenderId, "SOURCE_FILE_ADDED");
          return created;
        });
        sourceRowPersisted = true;
        results.push({
          success: true,
          scope: "tender",
          fileRecord: record,
          extraction: { fileType, extractionStatus: "QUEUED" },
          storageProvider: stored.provider,
        });
        tenderExtractionInputs.push({
          userId: actor.id,
          companyId: company.id,
          tenderId,
          tenderFileId: record.id,
          sourceContentSha256: contentHash,
          intakeSessionId: intake?.sessionId ?? null,
          deferAnalysis,
        });
        await logAction({
          userId: actor.id,
          action: "TENDER_FILE_UPLOAD",
          entityType: "TenderFile",
          entityId: record.id,
          description: `Uploaded validated ${fileType} file to tender`,
          metadata: {
            tenderId,
            fileName,
            storageProvider: stored.provider,
            extractionStatus: "QUEUED",
            extractionOwner: "EXTRACT_TEXT",
          },
          requestId,
        }).catch((error) => {
          logger.warn("[secure-upload] tender upload audit persistence failed", {
            requestId,
            tenderId,
            fileId: record.id,
            errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
          });
        });
      } else {
        const categoryValue = formData.get("category");
        const providedCategory = typeof categoryValue === "string" ? categoryValue : null;
        const category = providedCategory && providedCategory !== "AUTO"
          ? providedCategory
          : detectCategoryFromFile(fileName, mimeType);
        const record = await prisma.companyDocument.create({
          data: {
            companyId: company.id,
            fileName,
            originalFileName: fileName,
            mimeType,
            size: buffer.byteLength,
            storagePath: stored!.storagePath,
            fileContent: stored!.fileContent ?? null,
            ...integrity,
            category,
            extractedText: null,
            aiExtractionStatus: "PENDING",
            aiExtractedAt: null,
            aiExtractionError: null,
            metadata: JSON.stringify({
              category,
              autoDetected: !providedCategory || providedCategory === "AUTO",
              storageProvider: stored.provider,
              extractionRevision: 0,
              extractionStatus: "QUEUED",
              extractionOwner: "VAULT_INGEST",
              fileType,
            }),
          },
          select: { id: true, companyId: true, fileName: true, originalFileName: true, mimeType: true, size: true, category: true, integrityStatus: true, contentSha256: true, contentByteLength: true, detectedFormat: true, createdAt: true },
        });
        sourceRowPersisted = true;
        companyFilesCreated += 1;
        results.push({
          success: true,
          scope: "company",
          docRecord: record,
          extraction: { fileType, extractionStatus: "QUEUED" },
          storageProvider: stored.provider,
        });
        await logAction({
          userId: actor.id,
          action: "COMPANY_DOCUMENT_UPLOAD",
          entityType: "CompanyDocument",
          entityId: record.id,
          description: `Uploaded validated ${fileType} company document`,
          metadata: {
            companyId: company.id,
            fileName,
            category,
            storageProvider: stored.provider,
            extractionRevision: 0,
            extractionStatus: "QUEUED",
            extractionOwner: "VAULT_INGEST",
          },
          requestId,
        }).catch((error) => {
          logger.warn("[secure-upload] company upload audit persistence failed", {
            requestId,
            companyId: company.id,
            documentId: record.id,
            errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
          });
        });
      }
    } catch (error) {
      if (stored && !sourceRowPersisted) {
        await storage.deleteFile({ storagePath: stored.storagePath, fileContent: stored.fileContent, fileName: file.name }).catch(() => {});
      }
      logger.error(`[secure-upload] requestId=${requestId} file=${file.name}: ${sanitizeError(error)}`);
      results.push({ success: false, fileName: file.name, error: "Upload processing failed. Use the request ID when contacting support.", requestId });
    }
  }

  let processingJobId: string | null = null;
  let analysisRevision: string | null = null;
  let processingStage: "EXTRACT_TEXT_QUEUED" | null = null;
  let pipelineWarning: string | null = null;
  const uploadBatchFailed = results.some((result) => result.success !== true);
  let intakeSession: TenderPackageSessionResult | null = packageBatch?.ok ? packageBatch.session : null;
  let sourcePackageComplete = !intake;
  if (intake && packageBatch?.ok && !packageBatch.replayed) {
    const createdFileIds = results
      .map((result) => {
        const fileRecord = result.fileRecord;
        return fileRecord && typeof fileRecord === "object" && "id" in fileRecord && typeof fileRecord.id === "string"
          ? fileRecord.id
          : null;
      })
      .filter((id): id is string => Boolean(id));
    if (uploadBatchFailed || createdFileIds.length !== files.length) {
      await failTenderPackageBatch({
        prisma,
        runId: packageBatch.runId,
        createdFileIds,
        errorCode: "INTAKE_BATCH_INCOMPLETE",
      });
    } else {
      const completed = await completeTenderPackageBatch({
        prisma,
        companyId: company.id,
        tenderId: tenderId!,
        descriptor: intake,
        runId: packageBatch.runId,
        createdFileIds,
      });
      sourcePackageComplete = completed.sessionComplete;
      intakeSession = completed.session;
    }
  }

  // Package state is reconciled before jobs become visible. Each deterministic
  // job is safe to replay and is bound to the exact persisted source hash.
  if (tenderId && tenderExtractionInputs.length > 0) {
    for (const input of tenderExtractionInputs) {
      try {
        const extractionJob = await enqueueTenderFileExtractionJob(prisma, input);
        if (!processingJobId) {
          processingJobId = extractionJob.id;
          processingStage = "EXTRACT_TEXT_QUEUED";
        }
      } catch (error) {
        pipelineWarning = "Files were stored, but durable source extraction could not be queued. Retry the upload safely.";
        logger.error("[secure-upload] tender extraction enqueue failed", {
          requestId,
          tenderId,
          errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
        });
      }
    }
  }

  // This is a readiness check, not request-bound extraction. It closes the
  // final-batch/replay case where every source was already extracted before
  // the package session became complete. Pending jobs will perform the same
  // continuation after their durable checkpoints are written.
  if (tenderId && sourcePackageComplete && !uploadBatchFailed && (!deferAnalysis || Boolean(intake))) {
    try {
      const continuation = await continueTenderPipelineAfterExtraction({
        userId: actor.id,
        tenderId,
        companyId: company.id,
        intakeSessionId: intake?.sessionId ?? null,
        deferAnalysis,
      });
      void continuation;
    } catch (error) {
      pipelineWarning = pipelineWarning
        ?? "Source extraction is durable, but automatic analysis continuation must retry.";
      logger.error("[secure-upload] tender continuation check failed", {
        requestId,
        tenderId,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
    }
  }

  // Company Vault re-ingestion (deterministic regex + optional AI extraction
  // over every usable document) previously ran synchronously here, inside
  // the 60s-capped upload request. It now runs as a background VAULT_INGEST
  // job so a slow AI extraction pass on a large document set cannot risk the
  // request timeout; the response reports "QUEUED" instead of the finished
  // ingestion result, and new/updated Expert/Project drafts appear in the
  // Company Vault review queue once the job completes.
  let companyImport: Record<string, unknown> | null = null;
  if (!tenderId && companyFilesCreated > 0) {
    try {
      const job = await enqueueJob({
        userId: actor.id,
        jobType: "VAULT_INGEST",
        input: { companyId: company.id, reExtractAll: true },
      });
      companyImport = { status: "QUEUED", jobId: job.id };
    } catch (error) {
      logger.error(`[secure-upload] requestId=${requestId} company import enqueue failed: ${sanitizeError(error)}`);
      companyImport = { status: "FAILED", error: "Company knowledge import could not be queued", requestId };
    }
  }

  const uploaded = results.filter((item) => item.success === true).length;
  const errors = results.length - uploaded;
  return NextResponse.json(
    {
      success: uploaded > 0,
      uploaded,
      errors,
      results,
      processingJobId,
      analysisRevision,
      pipelineStage: processingStage,
      pipelineDeferred: Boolean(tenderId && (intake ? !sourcePackageComplete : deferAnalysis)),
      pipelineWarning,
      intakeSessionId: intake?.sessionId ?? null,
      intakeSession,
      engineQueued: false,
      companyImport,
    },
    { status: errors > 0 && uploaded === 0 ? 422 : tenderId ? 202 : 200 },
  );
}
