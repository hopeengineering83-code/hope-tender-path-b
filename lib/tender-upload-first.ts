import crypto from "crypto";
import { inspectActualFileBytes, type PersistedByteIntegrity } from "./engine/persisted-byte-integrity";
import { NextResponse } from "next/server";
import { requireRole } from "./auth";
import { logAction } from "./audit";
import { ensureCompanyForUser } from "./company-workspace";
import { assessExtractionQuality, assessExtractionQualityPerPage } from "./extraction-quality";
import { extractTextFromBuffer, getFileTypeLabel, isMeaningfulExtraction } from "./extract-text";
import { inferTenderMetadata } from "./engine/tender-metadata";
import { enrichMetadataWithSourceEvidence } from "./engine/metadata-source-enrichment";
import { buildCandidatesFromMetadata } from "./engine/candidate-pipeline";
import { reportError, logger } from "./observability";
import { prisma, prismaReady } from "./prisma";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "./rate-limit";
import { extractRequestId } from "./request-id";
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
  integrity: PersistedByteIntegrity;
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
  pageStatusJson: string | null;
  ocrModel: string | null;
} {
  const quality = assessExtractionQuality(extractedText);
  // Fixed: the regex was looking for "[OCR text...]" but extract-text.ts emits
  // "[PDF text extracted via Claude vision OCR...]". The old regex never matched,
  // so ocrPages was always null from this path. Now matches the actual marker.
  const ocrPageMarkers = (extractedText.match(/\[PDF text extracted via Claude vision OCR[^\]]*\]/gi) ?? []).length;
  const failedPageMarkers = (extractedText.match(/\[Extraction failed for[^\]]*\]/gi) ?? []).length;
  // Use assessExtractionQualityPerPage to derive totalPages — mirrors the
  // secure-upload-handler path. For PDFs with [Page N] markers, returns the
  // marker count. For DOCX/XLSX/PPTX/CSV (no markers), falls back to
  // DOCUMENT_LEVEL mode and returns 1 (was null — blocked all non-PDF tenders
  // from generation via hasUnknownPageCount). For empty/failed extraction,
  // returns 0 → totalPages stays null (correctly blocks).
  const perPageReport = assessExtractionQualityPerPage(extractedText);
  const totalPages = perPageReport.totalDetectedPages > 0 ? perPageReport.totalDetectedPages : null;
  const ocrPages = ocrPageMarkers > 0 ? ocrPageMarkers : null;
  const failedPages = failedPageMarkers > 0 ? failedPageMarkers : null;
  const extractedPages = totalPages === null ? null : Math.max(0, totalPages - (failedPages ?? 0));

  let extractionMethod: string | null = null;
  if (quality.hasExtractionFailure && quality.score < 20) extractionMethod = "failed";
  else if (quality.hasOcrPlaceholder || (ocrPages ?? 0) > 0) {
    extractionMethod = extractedPages !== null && ocrPages !== null && ocrPages < extractedPages ? "mixed" : "ocr";
  } else if (extractedText.trim().length > 0) extractionMethod = "text";

  // Persist per-page status JSON so the Extraction Quality dashboard reads
  // stored truth instead of seeing PAGE_STATUS_INCOMPLETE on every fresh
  // tender. Mirrors the secure-upload-handler path. Null when there are no
  // pages (empty/failed extraction) — the dashboard will then correctly show
  // "no pages detected" rather than a false "incomplete" warning.
  const pageStatusJson = perPageReport.pages.length > 0 ? JSON.stringify(perPageReport.pages) : null;

  // Extract the OCR model name from the marker prefix so the dashboard's
  // "OCR engine" badge is honest. The marker format is:
  //   [PDF text extracted via Claude vision OCR — N page(s). ocrReason=...]
  // The model name is set by PDF_OCR_MODEL env (default claude-3-5-sonnet-latest)
  // in lib/extract-text.ts. We can't read that env here without coupling, so
  // we extract a stable label from the marker text itself.
  let ocrModel: string | null = null;
  if (ocrPageMarkers > 0) {
    const markerMatch = extractedText.match(
      /\[PDF text extracted via Claude vision OCR[^\]]*\]/i,
    );
    if (markerMatch) {
      ocrModel = "claude-vision";
    }
  }
  if (!ocrModel && quality.hasOcrPlaceholder) {
    // OCR was attempted but failed (timeout / auth / rate-limit / empty output).
    // Still record the model label so the UI shows which engine was used.
    ocrModel = "claude-vision";
  }

  return {
    totalPages,
    extractedPages,
    ocrPages,
    failedPages,
    extractionScore: quality.score,
    extractionMethod,
    pageStatusJson,
    ocrModel,
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

    // Per-file deadline — prevents a single slow OCR call from consuming the
    // entire 60s Vercel budget. 45s leaves ~15s for storage + DB writes +
    // response. Matches the admin-repair route's deadline pattern.
    const uploadDeadline = Date.now() + 45_000;

    for (const file of files) {
      // Check deadline before each file — if exceeded, skip remaining files
      // and return a warning so the user knows not all files were processed.
      if (Date.now() > uploadDeadline) {
        warnings.push(`Time budget exceeded — remaining files skipped. Re-upload remaining files separately.`);
        break;
      }
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
        logger.warn("[upload-first] source extraction failed", {
        requestId,
        fileName: validation.safeFileName,
        errorClass: extractionError instanceof Error
          ? extractionError.constructor.name
          : "UnknownError",
      });
      warnings.push(`${validation.safeFileName}: file stored, but text extraction failed. Run OCR or re-extraction.`);
      }

      storedUploads.push({
        originalFileName: validation.safeFileName,
        fileName: validation.safeFileName,
        mimeType: validation.normalizedMime,
        size: buffer.byteLength,
        storagePath: stored.storagePath,
        fileContent: stored.fileContent ?? null,
        storageProvider: stored.provider,
        // Byte integrity is pinned from the ACTUAL uploaded bytes (truth
        // recorded even when not VERIFIED — export gates enforce at read).
        integrity: inspectActualFileBytes({ bytes: buffer, filename: validation.safeFileName, claimedMimeType: validation.normalizedMime }),
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
          currency: metadata.currency ?? null,
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
          notes: `Created from ${storedUploads.length} validated tender source file(s). ${meaningfulUploads.length === 0 ? "Files were stored, but text extraction requires review or OCR before AI Analyze." : "Extracted Tender Details must be reviewed before final submission."}`,
          status: "DRAFT",
          stage: "TENDER_INTAKE",
          userId: actor.id,
        },
      });

      const fileRecords: Array<{ id: string; originalFileName: string; totalPages: number | null }> = [];
      for (const upload of storedUploads) {
        const metrics = deriveFileExtractionMetrics(upload.extractedText);
        // Compute contentHash for dedup — prevents duplicate uploads of the
        // same file content. Uses crypto.createHash on the raw file content
        // (or extractedText as fallback for inline-stored files).
        const contentHash = crypto.createHash("md5").update(upload.fileContent ?? upload.extractedText ?? "").digest("hex");
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
            extractedText: upload.extractedText || null,
            contentHash,
            totalPages: metrics.totalPages,
            extractedPages: metrics.extractedPages,
            ocrPages: metrics.ocrPages,
            failedPages: metrics.failedPages,
            extractionScore: metrics.extractionScore,
            extractionMethod: metrics.extractionMethod,
            pageStatusJson: metrics.pageStatusJson,
            ocrModel: metrics.ocrModel,
          },
          select: { id: true, originalFileName: true, totalPages: true },
        }));
      }

      return { tender, fileRecords };
    }, { timeout: 30_000 });

  // Enrich source evidence: locate each critical field value in the uploaded
  // files' extracted text and persist the fileId + page + quote so the
  // canonical resolver can mark them as EXTRACTED_AND_GROUNDED. Without this,
  // fresh tenders have zero grounded metadata until AI Analyze or
  // repair-metadata is run. The file IDs are available now (after the
  // transaction committed); we run a targeted update with only the evidence
  // columns that were found.
  const enrichmentFiles = persisted.fileRecords.map((fr, i) => ({
    id: fr.id,
    extractedText: storedUploads[i]?.extractedText ?? null,
    deletionStatus: "ACTIVE" as const,
    totalPages: fr.totalPages,
    contentHash: null, // enrichment files don't carry the hash; candidate-pipeline handles null
  }));
  // Wrapped in try/catch (best-effort, non-fatal): if enrichment throws
  // (e.g., a file with malformed text that defeats the normalized-index
  // builder), the upload itself still succeeds — the tender and files are
  // persisted, just without source evidence. Fields stay EXTRACTED_UNVERIFIED
  // until AI Analyze or repair-metadata is run. This mirrors the try/catch
  // pattern in metadata-override, ai-analyze, and re-extract-metadata.
  try {
    const enrichment = enrichMetadataWithSourceEvidence({
      title: persisted.tender.title,
      reference: persisted.tender.reference,
      clientName: persisted.tender.clientName,
      deadline: persisted.tender.deadline,
      submissionMethod: persisted.tender.submissionMethod,
      submissionAddress: persisted.tender.submissionAddress,
      submissionEmails: persisted.tender.submissionEmails,
      submissionEmailSubject: persisted.tender.submissionEmailSubject,
      existingContactDetailsSourceJson: persisted.tender.contactDetailsSourceJson ?? null,
    }, enrichmentFiles);
    if (Object.keys(enrichment).length > 0) {
      await prisma.tender.update({ where: { id: tenderId }, data: enrichment as Record<string, unknown> });
    }

    // ─── Candidate pipeline (Gap 3 — wire candidate model into extraction) ──
    // Build TenderFactCandidate records for every extracted value, classify
    // them (CANDIDATE/GROUNDED/REJECTED/NEEDS_REVIEW), and log the promotion
    // decisions. The candidate pipeline is ADDITIVE — it does NOT change what
    // gets written to the Tender table (the existing enrichment flow above
    // already handles that). It only logs the candidate decisions for
    // observability and surfaces rejected/needs-review candidates for the UI.
    //
    // When the TenderFactCandidate DB table is added in a future migration,
    // the candidates will be persisted there. For now, they're logged as
    // structured warnings so operators can see which values were promoted,
    // which were rejected, and which need manual review.
    try {
      const candidatePipeline = buildCandidatesFromMetadata({
        values: {
          title: persisted.tender.title,
          reference: persisted.tender.reference,
          clientName: persisted.tender.clientName,
          deadline: persisted.tender.deadline,
          submissionMethod: persisted.tender.submissionMethod,
          submissionAddress: persisted.tender.submissionAddress,
          submissionEmailSubject: persisted.tender.submissionEmailSubject,
        },
        files: enrichmentFiles,
        candidateType: "regex",
        extractionSourcePrefix: "upload-first:inferTenderMetadata",
      });
      if (candidatePipeline.summary.rejected > 0 || candidatePipeline.summary.needsReview > 0) {
        logger.warn(
          `[upload-first] candidate pipeline for tender ${tenderId}: ` +
          `${candidatePipeline.summary.autoConfirmed} auto-confirmed, ` +
          `${candidatePipeline.summary.grounded} grounded, ` +
          `${candidatePipeline.summary.needsReview} needs-review, ` +
          `${candidatePipeline.summary.rejected} rejected, ` +
          `${candidatePipeline.summary.deferred} deferred`,
          {
            rejected: candidatePipeline.rejected,
            needsReview: candidatePipeline.needsReview,
          },
        );
      }
    } catch (candidateErr) {
      // Best-effort — candidate pipeline failure must NOT fail the upload.
      logger.warn(`[upload-first] candidate pipeline failed for tender ${tenderId}: ${candidateErr instanceof Error ? candidateErr.message : String(candidateErr)}`);
    }
  } catch {
    // Best-effort, non-fatal. The tender and files are already persisted
    // (transaction committed above); only the source-evidence enrichment
    // is skipped. Fields stay EXTRACTED_UNVERIFIED until AI Analyze or
    // repair-metadata is run.
  }

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
