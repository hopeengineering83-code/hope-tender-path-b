import crypto from "crypto";
import { NextResponse } from "next/server";
import { requireRole } from "./auth";
import { logAction } from "./audit";
import { ensureCompanyForUser } from "./company-workspace";
import { assessExtractionQuality } from "./extraction-quality";
import { extractTextFromBuffer, getFileTypeLabel, isMeaningfulExtraction } from "./extract-text";
import { inferTenderMetadata } from "./engine/tender-metadata";
import { reportError } from "./observability";
import { prisma, prismaReady } from "./prisma";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "./rate-limit";
import { extractRequestId } from "./request-id";
import { sanitizeError } from "./sanitize-error";
import { getStorageAdapter, type StorageProvider } from "./storage";
import { limitExtractedText, validateUploadBatch, validateUploadFile } from "./upload-security";

type StoredTenderUpload = {
  originalFileName: string;
  fileName: string;
  mimeType: string;
  size: number;
  storagePath: string;
  fileContent: string | null;
  storageProvider: StorageProvider;
  fileTypeLabel: string;
  extractedText: string;
  meaningful: boolean;
  extractionTruncated: boolean;
};

function deriveFileExtractionMetrics(extractedText: string): {
  totalPages: number | null;
  extractedPages: number | null;
  ocrPages: number | null;
  failedPages: number | null;
  extractionScore: number;
  extractionMethod: string | null;
} {
  const quality = assessExtractionQuality(extractedText);
  const pageMarkers = (extractedText.match(/\[Page\s+\d+\]/gi) ?? []).length;
  const ocrPageMarkers = (extractedText.match(/\[OCR text[^\]]*\]/gi) ?? []).length;
  const failedPageMarkers = (extractedText.match(/\[Extraction failed for[^\]]*\]/gi) ?? []).length;
  const totalPages = pageMarkers > 0 ? pageMarkers : null;
  const ocrPages = ocrPageMarkers > 0 ? ocrPageMarkers : null;
  const failedPages = failedPageMarkers > 0 ? failedPageMarkers : null;
  const extractedPages = totalPages === null ? null : Math.max(0, totalPages - (failedPages ?? 0));

  let extractionMethod: string | null = null;
  if (quality.hasExtractionFailure && quality.score < 20) extractionMethod = "failed";
  else if (quality.hasOcrPlaceholder || (ocrPages ?? 0) > 0) {
    extractionMethod = extractedPages !== null && ocrPages !== null && ocrPages < extractedPages ? "mixed" : "ocr";
  } else if (extractedText.trim().length > 0) extractionMethod = "text";

  return {
    totalPages,
    extractedPages,
    ocrPages,
    failedPages,
    extractionScore: quality.score,
    extractionMethod,
  };
}

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
  try {
    const form = await req.formData();
    const files = form.getAll("file").filter((entry): entry is File => entry instanceof File);
    const batchError = validateUploadBatch(files);
    if (batchError) {
      return NextResponse.json({ error: batchError, code: "UPLOAD_BATCH_INVALID", errors: [batchError], requestId }, { status: 400 });
    }

    const company = await ensureCompanyForUser(prisma, actor.id);
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

      let stored: Awaited<ReturnType<typeof storage.putFile>>;
      try {
        stored = await storage.putFile(buffer, {
          fileName: validation.safeFileName,
          mimeType: validation.normalizedMime,
          companyId: company.id,
          tenderId,
        });
      } catch (storageError) {
        const message = storageError instanceof Error ? storageError.message : String(storageError);
        errors.push(`${validation.safeFileName}: storage failed — ${message}`);
        continue;
      }

      let extractedText = "";
      let extractionTruncated = false;
      try {
        const extracted = limitExtractedText(
          await extractTextFromBuffer(buffer, validation.normalizedMime, validation.safeFileName),
        );
        extractedText = extracted.text;
        extractionTruncated = extracted.truncated;
        if (extracted.truncated) warnings.push(`${validation.safeFileName}: extracted text was truncated to the safe analysis limit`);
      } catch (extractionError) {
        const message = extractionError instanceof Error ? extractionError.message : String(extractionError);
        warnings.push(`${validation.safeFileName}: file stored, but text extraction failed — ${message}`);
      }

      storedUploads.push({
        originalFileName: validation.safeFileName,
        fileName: validation.safeFileName,
        mimeType: validation.normalizedMime,
        size: buffer.byteLength,
        storagePath: stored.storagePath,
        fileContent: stored.fileContent ?? null,
        storageProvider: stored.provider,
        fileTypeLabel: getFileTypeLabel(validation.normalizedMime, validation.safeFileName),
        extractedText,
        meaningful: isMeaningfulExtraction(extractedText),
        extractionTruncated,
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

    const meaningfulUploads = storedUploads.filter((upload) => upload.meaningful);
    const weaklyUsable = storedUploads.filter((upload) => !upload.meaningful && upload.extractedText.trim().length >= 80);
    const effectiveUsable = meaningfulUploads.length > 0 ? meaningfulUploads : weaklyUsable;
    const metadataSources = effectiveUsable.length > 0 ? effectiveUsable : storedUploads;
    const combinedText = metadataSources
      .map((upload) => `FILE: ${upload.originalFileName}\n${upload.extractedText}`)
      .join("\n\n--- NEXT TENDER FILE ---\n\n");
    const metadata = inferTenderMetadata(combinedText, metadataSources[0]?.originalFileName ?? "uploaded-tender");
    const titleOverride = String(form.get("title") ?? "").trim();
    const referenceOverride = String(form.get("reference") ?? "").trim();

    const persisted = await prisma.$transaction(async (tx) => {
      const tender = await tx.tender.create({
        data: {
          id: tenderId,
          title: titleOverride || metadata.title,
          description: metadata.description,
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
          currency: metadata.currency || "USD",
          deadline: metadata.deadline,
          submissionMethod: metadata.submissionMethod,
          submissionAddress: metadata.submissionAddress,
          intakeSummary: metadata.intakeSummary,
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
          notes: `Created from ${storedUploads.length} validated tender source file(s). ${meaningfulUploads.length === 0 ? "Files were stored, but text extraction requires review or OCR before AI Analyze." : "Extracted metadata must be reviewed before final submission."}`,
          status: "DRAFT",
          stage: "TENDER_INTAKE",
          userId: actor.id,
        },
      });

      const fileRecords: Array<{ id: string; originalFileName: string }> = [];
      for (const upload of storedUploads) {
        const metrics = deriveFileExtractionMetrics(upload.extractedText);
        fileRecords.push(await tx.tenderFile.create({
          data: {
            tenderId,
            fileName: upload.fileName,
            originalFileName: upload.originalFileName,
            mimeType: upload.mimeType,
            size: upload.size,
            storagePath: upload.storagePath,
            fileContent: upload.fileContent,
            classification: "Tender Document",
            extractedText: upload.extractedText || null,
            totalPages: metrics.totalPages,
            extractedPages: metrics.extractedPages,
            ocrPages: metrics.ocrPages,
            failedPages: metrics.failedPages,
            extractionScore: metrics.extractionScore,
            extractionMethod: metrics.extractionMethod,
          },
          select: { id: true, originalFileName: true },
        }));
      }

      return { tender, fileRecords };
    }, { timeout: 30_000 });

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
          extracted: upload?.meaningful ?? false,
          extractedChars: upload?.extractedText.length ?? 0,
          extractionTruncated: upload?.extractionTruncated ?? false,
        },
        requestId,
      });
    }

    return NextResponse.json({
      success: true,
      tenderId,
      tender: persisted.tender,
      uploadedFiles: storedUploads.length,
      extractedFiles: meaningfulUploads.length,
      warnings,
      errors: [],
      engineSkipped: true,
      engineError: null,
      nextAction: meaningfulUploads.length > 0 ? "RUN_AI_ANALYZE" : "RUN_OCR_OR_REEXTRACT",
      message: meaningfulUploads.length > 0
        ? "Tender and source files were created. Open the tender and run AI Analyze."
        : "Tender and source files were created, but OCR or re-extraction is required before AI Analyze.",
      requestId,
    }, { status: 201 });
  } catch (error) {
    if (storedUploads.length > 0) await cleanupStoredUploads(storedUploads);
    const message = sanitizeError(error);
    console.error(`[upload-first tender] failed (requestId=${requestId}):`, error);
    void reportError(error, { route: "/api/tenders/upload-first", requestId });
    return NextResponse.json({
      success: false,
      error: `Upload-first tender intake failed: ${message}`,
      code: "TENDER_INTAKE_FAILED",
      detail: message,
      requestId,
    }, { status: 500 });
  }
}
