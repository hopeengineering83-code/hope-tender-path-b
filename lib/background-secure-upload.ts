import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { Prisma, PrismaClient } from "@prisma/client";
import { enqueueTenderFileExtractionJob } from "./ai-jobs/tender-extraction-service";
import { logAction } from "./audit";
import { requireRole } from "./auth";
import { ensureCompanyForUser } from "./company-workspace";
import { inspectActualFileBytes } from "./engine/persisted-byte-integrity";
import { invalidateTenderForSourceRevision } from "./engine/source-revision-invalidation";
import { detectCategoryFromFile } from "./extract-text";
import { logger } from "./observability";
import { prisma, prismaReady } from "./prisma";
import { rateLimitPersistent, UPLOAD_RATE_LIMIT } from "./rate-limit";
import { extractRequestId } from "./request-id";
import { sanitizeError } from "./sanitize-error";
import { getStorageAdapter } from "./storage";
import {
  beginTenderPackageBatch,
  completeTenderPackageBatch,
  failTenderPackageBatch,
  fingerprintTenderPackageBatch,
  parseTenderPackageIntake,
  type TenderPackageSessionResult,
} from "./tender-package-intake-session";
import { validateUploadBatch, validateUploadFile } from "./upload-security";

export const BACKGROUND_SECURE_UPLOAD_HANDLER = "BACKGROUND_SECURE_UPLOAD_V1";

type JobDb = Pick<PrismaClient, "aiJob"> | Pick<Prisma.TransactionClient, "aiJob">;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function vaultIngestRunId(companyId: string, batchHash: string): string {
  return `vault-ingest-v2:${companyId}:${batchHash}`;
}

async function enqueueVaultIngest(
  db: JobDb,
  input: { userId: string; companyId: string; documentIds: string[]; contentHashes: string[] },
): Promise<{ id: string; status: string; reused: boolean }> {
  const batchHash = sha256(JSON.stringify({
    documentIds: [...input.documentIds].sort(),
    contentHashes: [...input.contentHashes].sort(),
  }));
  const runId = vaultIngestRunId(input.companyId, batchHash);
  const existing = await db.aiJob.findUnique({ where: { runId }, select: { id: true, status: true } });
  if (existing) return { ...existing, reused: true };
  const payload = JSON.stringify({
    companyId: input.companyId,
    reExtractAll: true,
    sourceDocumentIds: input.documentIds,
    sourceBatchHash: batchHash,
    purpose: "COMPANY_SOURCE_EXTRACTION_AND_INGESTION",
  });
  try {
    const created = await db.aiJob.create({
      data: {
        runId,
        userId: input.userId,
        jobType: "VAULT_INGEST",
        input: payload,
        analysisInputHash: sha256(payload),
        status: "QUEUED",
      },
      select: { id: true, status: true },
    });
    return { ...created, reused: false };
  } catch (error) {
    if ((error as { code?: string })?.code !== "P2002") throw error;
    const winner = await db.aiJob.findUnique({ where: { runId }, select: { id: true, status: true } });
    if (!winner) throw error;
    return { ...winner, reused: true };
  }
}

export async function handleSecureUpload(req: Request): Promise<NextResponse> {
  const requestId = extractRequestId(req);
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch {
    return NextResponse.json({ error: "Forbidden", requestId }, { status: 403 });
  }

  const rate = await rateLimitPersistent(`upload:${actor.id}`, UPLOAD_RATE_LIMIT);
  if (!rate.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
    return NextResponse.json({ error: "Upload rate limit exceeded", requestId }, {
      status: 429,
      headers: { "Retry-After": String(retryAfter) },
    });
  }

  await prismaReady;
  const formData = await req.formData();
  const files = formData.getAll("file").filter((entry): entry is File => entry instanceof File);
  const batchError = validateUploadBatch(files);
  if (batchError) return NextResponse.json({ error: batchError, requestId }, { status: 400 });

  const tenderValue = formData.get("tenderId");
  const tenderId = typeof tenderValue === "string" && tenderValue ? tenderValue : null;
  const companyDoc = formData.get("companyDoc") === "true";
  const classificationValue = formData.get("classification");
  const classification = typeof classificationValue === "string" ? classificationValue : null;
  const deferAnalysis = formData.get("deferAnalysis") === "true";
  if (!tenderId && !companyDoc) {
    return NextResponse.json({ error: "tenderId or companyDoc=true is required", requestId }, { status: 400 });
  }

  const intakeParse = parseTenderPackageIntake(formData, files);
  if (!intakeParse.ok) {
    return NextResponse.json({ error: intakeParse.error, code: intakeParse.code, requestId }, { status: 400 });
  }
  const intake = intakeParse.descriptor;
  if (intake && (!tenderId || companyDoc)) {
    return NextResponse.json({
      error: "Tender package sessions can append only to an existing tender.",
      code: "INTAKE_TENDER_REQUIRED",
      requestId,
    }, { status: 400 });
  }

  const company = await ensureCompanyForUser(prisma, actor.id);
  const tender = tenderId
    ? await prisma.tender.findFirst({ where: { id: tenderId, userId: actor.id }, select: { id: true } })
    : null;
  if (tenderId && !tender) return NextResponse.json({ error: "Tender not found", requestId }, { status: 404 });

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
    return NextResponse.json({ error: packageBatch.error, code: packageBatch.code, requestId }, { status: packageBatch.status });
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
          },
        })
      : [];
    const extractionJobs = [];
    for (const record of records) {
      if (!record.contentSha256) continue;
      extractionJobs.push(await enqueueTenderFileExtractionJob(prisma, {
        userId: actor.id,
        companyId: company.id,
        tenderId: record.tenderId,
        tenderFileId: record.id,
        sourceContentSha256: record.contentSha256,
        intakeSessionId: intake?.sessionId ?? null,
        deferAnalysis,
      }));
    }
    return NextResponse.json({
      success: true,
      replayed: true,
      uploaded: records.length,
      errors: 0,
      results: records.map((fileRecord) => ({ success: true, scope: "tender", replayed: true, fileRecord })),
      extractionJobs,
      processingJobId: packageBatch.session.analysisJobId,
      analysisRevision: packageBatch.session.analysisRevision,
      pipelineStage: packageBatch.session.analysisJobId ? "AI_ANALYZE_QUEUED" : "SOURCE_EXTRACTION_QUEUED",
      pipelineDeferred: packageBatch.session.missingBatchIndexes.length > 0,
      intakeSessionId: intake?.sessionId ?? null,
      intakeSession: packageBatch.session,
      engineQueued: false,
      requestId,
    }, { status: 200 });
  }

  const storage = getStorageAdapter();
  const results: Array<Record<string, unknown>> = [];
  const companyDocumentIds: string[] = [];
  const companyContentHashes: string[] = [];
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
      if (integrity.integrityStatus !== "VERIFIED" || !integrity.contentSha256) {
        results.push({
          success: false,
          fileName,
          error: "File byte integrity verification failed.",
          code: integrity.integrityFailureCode ?? "FILE_INTEGRITY_NOT_VERIFIED",
        });
        continue;
      }
      const contentHash = integrity.contentSha256;

      if (tenderId) {
        const existingFile = await prisma.tenderFile.findFirst({
          where: { tenderId, contentHash, deletionStatus: "ACTIVE" },
          select: {
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
          },
        });
        if (existingFile?.contentSha256) {
          const extractionJob = await enqueueTenderFileExtractionJob(prisma, {
            userId: actor.id,
            companyId: company.id,
            tenderId,
            tenderFileId: existingFile.id,
            sourceContentSha256: existingFile.contentSha256,
            intakeSessionId: intake?.sessionId ?? null,
            deferAnalysis,
          });
          results.push({ success: true, scope: "tender", replayed: true, fileRecord: existingFile, extractionJob });
          if (intake) tenderFilesCreated += 1;
          continue;
        }
      } else {
        const existingDocument = await prisma.companyDocument.findFirst({
          where: { companyId: company.id, contentSha256: contentHash, integrityStatus: "VERIFIED" },
          select: {
            id: true,
            companyId: true,
            fileName: true,
            originalFileName: true,
            mimeType: true,
            size: true,
            category: true,
            integrityStatus: true,
            contentSha256: true,
            contentByteLength: true,
            detectedFormat: true,
            createdAt: true,
          },
        });
        if (existingDocument) {
          companyDocumentIds.push(existingDocument.id);
          companyContentHashes.push(contentHash);
          results.push({ success: true, scope: "company", replayed: true, docRecord: existingDocument });
          continue;
        }
      }

      stored = await storage.putFile(buffer, {
        fileName,
        mimeType,
        companyId: company.id,
        tenderId: tenderId ?? undefined,
      });
      if (!stored) throw new Error("STORAGE_WRITE_DID_NOT_RETURN_A_RECORD");

      if (tenderId) {
        const created = await prisma.$transaction(async (tx) => {
          const fileRecord = await tx.tenderFile.create({
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
              extractionMethod: null,
              contentHash,
            },
            select: {
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
            },
          });
          await invalidateTenderForSourceRevision(tx, tenderId, "SOURCE_FILE_ADDED");
          const extractionJob = await enqueueTenderFileExtractionJob(tx, {
            userId: actor.id,
            companyId: company.id,
            tenderId,
            tenderFileId: fileRecord.id,
            sourceContentSha256: fileRecord.contentSha256!,
            intakeSessionId: intake?.sessionId ?? null,
            deferAnalysis,
          });
          return { fileRecord, extractionJob };
        });
        tenderFilesCreated += 1;
        results.push({
          success: true,
          scope: "tender",
          fileRecord: created.fileRecord,
          extractionJob: created.extractionJob,
          extraction: { status: "QUEUED", extracted: false, extractedChars: 0 },
          storageProvider: stored.provider,
        });
        await logAction({
          userId: actor.id,
          action: "TENDER_FILE_UPLOAD",
          entityType: "TenderFile",
          entityId: created.fileRecord.id,
          description: "Uploaded verified tender bytes and queued durable background extraction.",
          metadata: {
            tenderId,
            fileName,
            storageProvider: stored.provider,
            sourceContentSha256: contentHash,
            extractionJobId: created.extractionJob.id,
          },
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
            storagePath: stored.storagePath,
            fileContent: stored.fileContent ?? null,
            ...integrity,
            category,
            extractedText: null,
            aiExtractionStatus: "PENDING",
            metadata: JSON.stringify({
              category,
              autoDetected: !providedCategory || providedCategory === "AUTO",
              storageProvider: stored.provider,
              extractionRevision: 1,
              extractionStatus: "QUEUED",
              sourceContentSha256: contentHash,
            }),
          },
          select: {
            id: true,
            companyId: true,
            fileName: true,
            originalFileName: true,
            mimeType: true,
            size: true,
            category: true,
            integrityStatus: true,
            contentSha256: true,
            contentByteLength: true,
            detectedFormat: true,
            createdAt: true,
          },
        });
        companyDocumentIds.push(record.id);
        companyContentHashes.push(contentHash);
        results.push({
          success: true,
          scope: "company",
          docRecord: record,
          extraction: { status: "QUEUED", extracted: false, extractedChars: 0 },
          storageProvider: stored.provider,
        });
        await logAction({
          userId: actor.id,
          action: "COMPANY_DOCUMENT_UPLOAD",
          entityType: "CompanyDocument",
          entityId: record.id,
          description: "Uploaded verified Company Vault bytes and queued durable extraction/ingestion.",
          metadata: {
            companyId: company.id,
            fileName,
            category,
            storageProvider: stored.provider,
            extractionRevision: 1,
            sourceContentSha256: contentHash,
          },
          requestId,
        });
      }
    } catch (error) {
      if (stored) {
        await storage.deleteFile({
          storagePath: stored.storagePath,
          fileContent: stored.fileContent,
          fileName: file.name,
        }).catch(() => undefined);
      }
      logger.error("[secure-upload] file processing failed", {
        requestId,
        fileName: file.name,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
      results.push({
        success: false,
        fileName: file.name,
        error: "Upload processing failed. Use the request ID when contacting support.",
        requestId,
      });
    }
  }

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

  let companyImport: Record<string, unknown> | null = null;
  if (!tenderId && companyDocumentIds.length > 0) {
    try {
      const job = await enqueueVaultIngest(prisma, {
        userId: actor.id,
        companyId: company.id,
        documentIds: companyDocumentIds,
        contentHashes: companyContentHashes,
      });
      companyImport = { status: job.status, jobId: job.id, reused: job.reused };
    } catch (error) {
      logger.error("[secure-upload] company extraction enqueue failed", {
        requestId,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
        safeCategory: sanitizeError(error),
      });
      companyImport = {
        status: "FAILED",
        error: "Company knowledge extraction could not be queued.",
        requestId,
      };
    }
  }

  const uploaded = results.filter((item) => item.success === true).length;
  const errors = results.length - uploaded;
  const extractionJobs = results
    .map((result) => result.extractionJob)
    .filter((job): job is Record<string, unknown> => Boolean(job && typeof job === "object"));

  return NextResponse.json({
    success: uploaded > 0,
    uploaded,
    errors,
    results,
    extractionJobs,
    processingJobId: null,
    analysisRevision: null,
    pipelineStage: tenderId && uploaded > 0 ? "SOURCE_EXTRACTION_QUEUED" : null,
    pipelineDeferred: Boolean(tenderId && (intake ? !sourcePackageComplete : deferAnalysis)),
    pipelineWarning: null,
    intakeSessionId: intake?.sessionId ?? null,
    intakeSession,
    engineQueued: false,
    companyImport,
    nextAction: tenderId
      ? sourcePackageComplete
        ? "WAIT_FOR_SOURCE_EXTRACTION"
        : "UPLOAD_REMAINING_SOURCE_FILES"
      : companyImport?.status === "QUEUED"
        ? "WAIT_FOR_VAULT_INGESTION"
        : null,
    requestId,
  }, { status: errors > 0 && uploaded === 0 ? 422 : tenderId ? 202 : 200 });
}
