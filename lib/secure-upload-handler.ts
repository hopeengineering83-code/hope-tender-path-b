import { logger } from "./observability";
import { NextResponse } from "next/server";
import { prisma, prismaReady } from "./prisma";
import { requireRole } from "./auth";
import { extractTextFromBuffer, detectCategoryFromFile, getFileTypeLabel, isMeaningfulExtraction } from "./extract-text";
import { assessExtractionQuality, assessExtractionQualityPerPage } from "./extraction-quality";
import { logAction } from "./audit";
import { ensureCompanyForUser } from "./company-workspace";
import { importCompanyKnowledgeFromDocuments } from "./company-knowledge-import-safe";
import { runCompanyKnowledgeSafetyImport } from "./company-knowledge-safety-import";
import { rateLimitPersistent, UPLOAD_RATE_LIMIT } from "./rate-limit";
import { extractRequestId } from "./request-id";
import { getStorageAdapter } from "./storage";
import { enqueueJob, findActiveEngineRunForTender } from "./ai-jobs";
import { limitExtractedText, validateUploadBatch, validateUploadFile } from "./upload-security";
import { sanitizeError } from "./sanitize-error";
import { inspectActualFileBytes } from "./engine/persisted-byte-integrity";
import { invalidateTenderForSourceRevision } from "./engine/source-revision-invalidation";

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
  if (!tenderId && !companyDoc) return NextResponse.json({ error: "tenderId or companyDoc=true is required" }, { status: 400 });

  const company = await ensureCompanyForUser(prisma, actor.id);
  const tender = tenderId
    ? await prisma.tender.findFirst({ where: { id: tenderId, userId: actor.id }, select: { id: true } })
    : null;
  if (tenderId && !tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

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
      const integrity = inspectActualFileBytes({
        bytes: buffer,
        filename: fileName,
        claimedMimeType: mimeType,
      });
      if (integrity.integrityStatus !== "VERIFIED") {
        results.push({
          success: false,
          fileName,
          error: "File byte integrity verification failed.",
          code: integrity.integrityFailureCode ?? "FILE_INTEGRITY_NOT_VERIFIED",
        });
        continue;
      }
      const extracted = limitExtractedText(await extractTextFromBuffer(buffer, mimeType, fileName));
      const fileType = getFileTypeLabel(mimeType, fileName);
      const extraction = extractionMetadata(fileType, extracted.text, extracted.truncated);
      // Persist page-level extraction diagnostics so the Extraction Quality
      // dashboard reads stored truth instead of recomputing on every render.
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
            metadata: JSON.stringify({ category, autoDetected: !providedCategory || providedCategory === "AUTO", storageProvider: stored.provider, ...extraction }),
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
          metadata: { companyId: company.id, fileName, category, storageProvider: stored.provider, ...extraction },
          requestId,
        });
      }
    } catch (error) {
      if (stored) {
        await storage.deleteFile({ storagePath: stored!.storagePath, fileContent: stored.fileContent, fileName: file.name }).catch(() => {});
      }
      logger.error(`[secure-upload] requestId=${requestId} file=${file.name}: ${sanitizeError(error)}`);
      results.push({ success: false, fileName: file.name, error: "Upload processing failed. Use the request ID when contacting support.", requestId });
    }
  }

  let processingJobId: string | null = null;
  if (tenderId && tenderFilesCreated > 0) {
    const active = await findActiveEngineRunForTender(tenderId, actor.id);
    processingJobId = active?.id ?? (await enqueueJob({ userId: actor.id, tenderId, jobType: "ENGINE_RUN", input: { safe: true, skipAiRematch: true, source: "secure-upload" } })).id;
  }

  let companyImport: Record<string, unknown> | null = null;
  if (!tenderId && companyFilesCreated > 0) {
    try {
      const primary = await importCompanyKnowledgeFromDocuments(company.id);
      const aiSucceeded = primary.aiUsed && primary.aiFailures === 0;
      const safety = aiSucceeded
        ? { docsScanned: 0, expertsCreated: 0, projectsCreated: 0, expertNamesDetected: 0, projectNamesDetected: 0 }
        : await runCompanyKnowledgeSafetyImport(prisma, company.id);
      companyImport = { ...primary, safetyImport: safety } as unknown as Record<string, unknown>;
    } catch (error) {
      logger.error(`[secure-upload] requestId=${requestId} company import failed: ${sanitizeError(error)}`);
      companyImport = { status: "FAILED", error: "Company knowledge import failed", requestId };
    }
  }

  const uploaded = results.filter((item) => item.success === true).length;
  const errors = results.length - uploaded;
  return NextResponse.json(
    { success: uploaded > 0, uploaded, errors, results, processingJobId, companyImport },
    { status: errors > 0 && uploaded === 0 ? 422 : tenderId ? 202 : 200 },
  );
}
