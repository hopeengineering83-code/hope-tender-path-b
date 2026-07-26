import { logger } from "./observability";
import { NextResponse } from "next/server";
import { prisma, prismaReady } from "./prisma";
import { requireRole } from "./auth";
import { extractTextFromBuffer, detectCategoryFromFile, getFileTypeLabel, isMeaningfulExtraction } from "./extract-text";
import { assessExtractionQuality, assessExtractionQualityPerPage } from "./extraction-quality";
import { logAction } from "./audit";
import { ensureCompanyForUser } from "./company-workspace";
import { rateLimitPersistent, UPLOAD_RATE_LIMIT } from "./rate-limit";
import { extractRequestId } from "./request-id";
import { getStorageAdapter } from "./storage";
import { queueAutomaticTenderPipeline } from "./ai-jobs/automatic-tender-pipeline";
import { enqueueJob } from "./ai-jobs";
import { limitExtractedText, validateUploadBatch, validateUploadFile } from "./upload-security";
import { sanitizeError } from "./sanitize-error";
import { inspectActualFileBytes } from "./engine/persisted-byte-integrity";
import { invalidateTenderForSourceRevision } from "./engine/source-revision-invalidation";
import {
  beginTenderPackageBatch,
  completeTenderPackageBatch,
  failTenderPackageBatch,
  fingerprintTenderPackageBatch,
  parseTenderPackageIntake,
  recordTenderPackageAnalysisJob,
  type TenderPackageSessionResult,
} from "./tender-package-intake-session";

function extractionMetadata(fileType: string, text: string, truncated: boolean) {
  const meaningful = isMeaningfulExtraction(text);
  return {
    fileType,
    extracted: meaningful,
    extractedChars: meaningful ? text.length : 0,
    extractionStatus: meaningful ? (truncated ? "TRUNCATED" : "EXTRACTED") : text ? "WARNING" : "EMPTY",
    extractionMessage: meaningful ? null : "No meaningful text extracted",
  };
}

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
      processingJobId: packageBatch.session.analysisJobId,
      analysisRevision: packageBatch.session.analysisRevision,
      pipelineStage: packageBatch.session.analysisJobId ? "AI_ANALYZE_QUEUED" : null,
      pipelineDeferred: packageBatch.session.missingBatchIndexes.length > 0,
      intakeSessionId: intake?.sessionId ?? null,
      intakeSession: packageBatch.session,
      engineQueued: false,
    }, { status: 200 });
  }

  const storage = getStorageAdapter();
  const results: Array<Record<string, unknown>> = [];
  let companyFilesCreated = 0;
  let tenderFilesCreated = 0;

  for (const file of files) {
    let stored: Awaited<ReturnType<typeof storage.putFile>> | null = null;
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
      if (integrity.integrityStatus !== "VERIFIED") {
        results.push({
          success: false,
          fileName,
          error: "File byte integrity verification failed.",
          code: integrity.integrityFailureCode ?? "FILE_INTEGRITY_NOT_VERIFIED",
        });
        continue;
      }
      const contentHash = integrity.contentSha256;

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
          if (intake) tenderFilesCreated += 1;
          continue;
        }
      }

      const extracted = limitExtractedText(await extractTextFromBuffer(buffer, mimeType, fileName));
      const fileType = getFileTypeLabel(mimeType, fileName);
      const extraction = extractionMetadata(fileType, extracted.text, extracted.truncated);
      const quality = assessExtractionQuality(extracted.text, fileName);
      const perPage = assessExtractionQualityPerPage(extracted.text);

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
              extractedText: extracted.text || null,
              totalPages: perPage.totalDetectedPages,
              extractedPages: perPage.totalDetectedPages - perPage.failedPages.length,
              ocrPages: perPage.ocrPages.length,
              failedPages: perPage.failedPages.length,
              extractionScore: quality.score,
              pageStatusJson: JSON.stringify(perPage.pages),
              contentHash,
            },
            select: { id: true, tenderId: true, fileName: true, originalFileName: true, mimeType: true, size: true, classification: true, integrityStatus: true, contentSha256: true, contentByteLength: true, detectedFormat: true, createdAt: true },
          });
          await invalidateTenderForSourceRevision(tx, tenderId, "SOURCE_FILE_ADDED");
          return created;
        });
        tenderFilesCreated += 1;
        results.push({ success: true, scope: "tender", fileRecord: record, extraction, storageProvider: stored.provider });
        await logAction({
          userId: actor.id,
          action: "TENDER_FILE_UPLOAD",
          entityType: "TenderFile",
          entityId: record.id,
          description: `Uploaded validated ${fileType} file to tender`,
          metadata: { tenderId, fileName, storageProvider: stored.provider, ...extraction },
          requestId,
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
            extractedText: extracted.text || null,
            metadata: JSON.stringify({
              category,
              autoDetected: !providedCategory || providedCategory === "AUTO",
              storageProvider: stored.provider,
              extractionRevision: 1,
              extractionScore: quality.score,
              pageStatus: perPage.pages,
              totalPages: perPage.totalDetectedPages,
              failedPages: perPage.failedPages,
              ocrPages: perPage.ocrPages,
              ...extraction,
            }),
          },
          select: { id: true, companyId: true, fileName: true, originalFileName: true, mimeType: true, size: true, category: true, integrityStatus: true, contentSha256: true, contentByteLength: true, detectedFormat: true, createdAt: true },
        });
        companyFilesCreated += 1;
        results.push({ success: true, scope: "company", docRecord: record, extraction, storageProvider: stored.provider });
        await logAction({
          userId: actor.id,
          action: "COMPANY_DOCUMENT_UPLOAD",
          entityType: "CompanyDocument",
          entityId: record.id,
          description: `Uploaded validated ${fileType} company document`,
          metadata: { companyId: company.id, fileName, category, storageProvider: stored.provider, extractionRevision: 1, ...extraction },
          requestId,
        });
      }
    } catch (error) {
      if (stored) {
        await storage.deleteFile({ storagePath: stored.storagePath, fileContent: stored.fileContent, fileName: file.name }).catch(() => {});
      }
      logger.error(`[secure-upload] requestId=${requestId} file=${file.name}: ${sanitizeError(error)}`);
      results.push({ success: false, fileName: file.name, error: "Upload processing failed. Use the request ID when contacting support.", requestId });
    }
  }

  let processingJobId: string | null = null;
  let analysisRevision: string | null = null;
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

  if (tenderId && tenderFilesCreated > 0 && sourcePackageComplete && !uploadBatchFailed && (!deferAnalysis || Boolean(intake))) {
    try {
      const pipeline = await queueAutomaticTenderPipeline({
        tenderId,
        userId: actor.id,
        companyId: company.id,
        source: "secure-upload",
      });
      processingJobId = pipeline.jobId;
      analysisRevision = pipeline.analysisRevision;
      if (intake) {
        await recordTenderPackageAnalysisJob({
          prisma,
          companyId: company.id,
          tenderId,
          sessionId: intake.sessionId,
          jobId: pipeline.jobId,
          analysisRevision: pipeline.analysisRevision,
        });
        if (intakeSession) {
          intakeSession = {
            ...intakeSession,
            analysisJobId: pipeline.jobId,
            analysisRevision: pipeline.analysisRevision,
          };
        }
      }
    } catch (error) {
      pipelineWarning = "Files were stored, but automatic analysis could not be queued. Open the tender and retry AI Analyze.";
      logger.error("[secure-upload] automatic tender pipeline queue failed", {
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
      const job = await enqueueJob({ userId: actor.id, jobType: "VAULT_INGEST", input: { companyId: company.id } });
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
      pipelineStage: processingJobId ? "AI_ANALYZE_QUEUED" : null,
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
