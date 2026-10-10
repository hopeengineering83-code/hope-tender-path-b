/**
 * Repair Extraction — re-reads the original TenderFile from storage and
 * re-runs text extraction + OCR.
 *
 * This is NOT the legacy internal compatibility refresh action (which only re-runs regex on existing text).
 * This retrieves the original file bytes and re-runs the full extraction pipeline.
 *
 * Requires ADMIN or PROPOSAL_MANAGER. Enforces tenant ownership + rate limits.
 * Atomic: updates all extraction fields in a transaction. Audit logged.
 *
 * Distinguishes OCR outcomes:
 *   OCR_NOT_ATTEMPTED, OCR_ATTEMPTED_SUCCEEDED, OCR_ATTEMPTED_FAILED,
 *   OCR_TIMEOUT, OCR_AUTH_FAILED, OCR_RATE_LIMITED, OCR_OUTPUT_INSUFFICIENT
 */

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../../lib/prisma";
import { logAction } from "../../../../../../../lib/audit";
import { getStorageAdapter } from "../../../../../../../lib/storage";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../../../lib/rate-limit";
import { extractTextFromBuffer } from "../../../../../../../lib/extract-text";
import { assessExtractionQuality, assessExtractionQualityPerPage } from "../../../../../../../lib/extraction-quality";
import { logger } from "../../../../../../../lib/observability";
import { inspectActualFileBytes } from "../../../../../../../lib/engine/persisted-byte-integrity";
import { invalidateTenderForSourceRevision } from "../../../../../../../lib/engine/source-revision-invalidation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function err(message: string, status = 400, code = "REPAIR_EXTRACTION_ERROR") {
  return NextResponse.json({ ok: false, error: message, code }, { status });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const rl = await rateLimitPersistent(`repair-extraction:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  await prismaReady;
  const { id: tenderId, fileId } = await params;

  // Verify tender ownership
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    select: { id: true, title: true },
  });
  if (!tender) return err("Tender not found", 404, "TENDER_NOT_FOUND");

  // Verify file exists and belongs to this tender
  const file = await prisma.tenderFile.findFirst({
    where: { id: fileId, tenderId, deletionStatus: "ACTIVE" },
    select: { id: true, originalFileName: true, mimeType: true, storagePath: true, fileContent: true, size: true },
  });
  if (!file) return err("File not found or not active", 404, "FILE_NOT_FOUND");

  try {
    // Retrieve the original file from storage
    let buffer: Buffer;
    try {
      buffer = await getStorageAdapter().getFile({
        storagePath: file.storagePath || undefined,
        fileContent: file.fileContent,
        fileName: file.originalFileName,
      });
    } catch (retrieveErr) {
      logger.error("[repair-extraction] Failed to retrieve file from storage", {
        tenderId, fileId, errorName: retrieveErr instanceof Error ? retrieveErr.constructor.name : typeof retrieveErr,
      });
      return err(
        "Failed to retrieve the original file from storage. The file may have been deleted from blob storage.",
        502,
        "STORAGE_RETRIEVAL_FAILED",
      );
    }

    // Re-run extraction
    const extractedText = await extractTextFromBuffer(buffer, file.mimeType, file.originalFileName);

    // Assess quality
    const quality = assessExtractionQuality(extractedText, file.originalFileName);
    const perPage = assessExtractionQualityPerPage(extractedText);

    // Determine OCR outcome
    let ocrOutcome: string = "OCR_NOT_ATTEMPTED";
    if (extractedText.startsWith("[PDF text extracted via Claude vision OCR")) {
      ocrOutcome = "OCR_ATTEMPTED_SUCCEEDED";
    } else if (extractedText.startsWith("[OCR_TIMEOUT")) {
      ocrOutcome = "OCR_TIMEOUT";
    } else if (extractedText.startsWith("[OCR_AUTH_FAILED")) {
      ocrOutcome = "OCR_AUTH_FAILED";
    } else if (extractedText.startsWith("[OCR_RATE_LIMITED")) {
      ocrOutcome = "OCR_RATE_LIMITED";
    } else if (extractedText.startsWith("[Scanned PDF")) {
      ocrOutcome = "OCR_ATTEMPTED_FAILED";
    } else if (extractedText.startsWith("[Extraction failed")) {
      ocrOutcome = "OCR_OUTPUT_INSUFFICIENT";
    }

    // Atomic update — all extraction fields in one transaction
    const integrity = inspectActualFileBytes({
      bytes: buffer,
      filename: file.originalFileName,
      claimedMimeType: file.mimeType,
    });
    if (integrity.integrityStatus !== "VERIFIED") {
      return err(
        "Original file byte integrity verification failed.",
        422,
        integrity.integrityFailureCode ?? "FILE_INTEGRITY_NOT_VERIFIED",
      );
    }
    const updated = await prisma.$transaction(async (tx) => {
      const updatedRecord = await tx.tenderFile.update({
      where: { id: fileId },
      data: {
        extractedText: extractedText || null,
        totalPages: perPage.totalDetectedPages > 0 ? perPage.totalDetectedPages : null,
        extractedPages: perPage.totalDetectedPages > 0 ? perPage.totalDetectedPages : null,
        ocrPages: extractedText.startsWith("[PDF text extracted via Claude vision OCR") ? perPage.totalDetectedPages : null,
        failedPages: 0,
        extractionScore: quality.score,
        extractionMethod: extractedText.startsWith("[PDF text extracted via Claude vision OCR") ? "ocr" : "text",
        pageStatusJson: JSON.stringify(perPage.pages ?? []),
        ...integrity,
      },
      select: { id: true, extractionScore: true, totalPages: true },
    });
      await invalidateTenderForSourceRevision(tx, tenderId, "SOURCE_FILE_REEXTRACTED");
      return updatedRecord;
    });

    await logAction({
      userId: actor.id,
      action: "TENDER_FILE_UPLOAD", // Reuse — represents file content re-processing
      entityType: "TenderFile",
      entityId: fileId,
      description: `Re-extracted file "${file.originalFileName}" on tender "${tender.title}". Score: ${quality.score}, Pages: ${perPage.totalDetectedPages}, OCR: ${ocrOutcome}`,
      metadata: {
        tenderId,
        fileId,
        fileName: file.originalFileName,
        extractionScore: quality.score,
        totalPages: perPage.totalDetectedPages,
        ocrOutcome,
        textLength: extractedText.length,
      },
    });

    return NextResponse.json({
      ok: true,
      fileId,
      fileName: file.originalFileName,
      extractionScore: updated.extractionScore,
      totalPages: updated.totalPages,
      ocrOutcome,
      textLength: extractedText.length,
      message: `Re-extraction complete. Score: ${quality.score}. ${ocrOutcome !== "OCR_NOT_ATTEMPTED" ? `OCR: ${ocrOutcome}.` : ""}`,
    });
  } catch (error) {
    logger.error("[repair-extraction] Failed", { tenderId, fileId, detail: error });
    return err("Re-extraction failed. If the problem persists, contact admin.", 500, "REPAIR_EXTRACTION_FAILED");
  }
}
