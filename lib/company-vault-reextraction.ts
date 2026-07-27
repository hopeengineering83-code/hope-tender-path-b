// Re-extracts text/OCR for every usable document in a Company Vault.
//
// Extracted out of app/api/company/reimport/route.ts so it can run inside a
// background VAULT_INGEST job (input.reExtractAll: true) instead of only
// inline in the request/response cycle. Looping OCR + text extraction over
// every company document is exactly the kind of large synchronous work that
// must not run inside an HTTP request — a vault with many/large scanned PDFs
// can exceed the platform's request time budget.
import { logger } from "./observability";
import { prisma } from "./prisma";
import { extractTextFromBuffer, getFileTypeLabel, isMeaningfulExtraction } from "./extract-text";
import { assessExtractionQuality, assessExtractionQualityPerPage } from "./extraction-quality";
import { inspectOfficeContainerBytes } from "./office-container-integrity";
import { inspectActualFileBytes } from "./engine/persisted-byte-integrity";
import { getStorageAdapter } from "./storage";
import { COMPANY_DOCUMENT_PENDING_DELETE_MARKER } from "./company-document-durable-deletion";
import { limitExtractedText } from "./upload-security";

export type ReextractAllResult = {
  reextracted: number;
  failedFiles: Array<{ name: string; error: string; code?: string }>;
};

function parseMetadata(value: string | null | undefined): Record<string, unknown> {
  try { return JSON.parse(value || "{}") as Record<string, unknown>; }
  catch (e) {
    logger.warn("[company-vault-reextraction] parseMetadata failed — returning {}", { detail: e });
    return {};
  }
}

function nextExtractionRevision(metadata: Record<string, unknown>): number {
  const current = Number(metadata.extractionRevision);
  return Number.isInteger(current) && current > 0 ? current + 1 : 2;
}

export async function reextractAllCompanyDocuments(
  companyId: string,
  options?: {
    // Document IDs already processed by an earlier, interrupted attempt at
    // this same batch (see the VAULT_INGEST job handler's checkpoint) — a
    // retry after a mid-batch crash resumes from the next unprocessed
    // document instead of restarting the whole vault from scratch.
    skipDocumentIds?: ReadonlySet<string>;
    // Invoked after each document is attempted (success or failure), so the
    // caller can persist an incremental checkpoint mid-loop rather than only
    // after the entire batch finishes.
    onDocumentDone?: (documentId: string) => Promise<void>;
  },
): Promise<ReextractAllResult> {
  const skip = options?.skipDocumentIds;
  const docs = await prisma.companyDocument.findMany({
    where: {
      companyId,
      NOT: { metadata: { contains: COMPANY_DOCUMENT_PENDING_DELETE_MARKER } },
      OR: [{ fileContent: { not: null } }, { storagePath: { not: "" } }],
      ...(skip && skip.size > 0 ? { id: { notIn: [...skip] } } : {}),
    },
    select: {
      id: true,
      originalFileName: true,
      mimeType: true,
      fileContent: true,
      storagePath: true,
      metadata: true,
    },
  });

  let reextracted = 0;
  const failedFiles: Array<{ name: string; error: string; code?: string }> = [];
  for (const doc of docs) {
    if (!doc.fileContent && !doc.storagePath) continue;
    const metadata = parseMetadata(doc.metadata);
    const extractionRevision = nextExtractionRevision(metadata);
    try {
      const buffer = doc.fileContent
        ? Buffer.from(doc.fileContent, "base64")
        : await getStorageAdapter().getFile({
            storagePath: doc.storagePath,
            fileContent: null,
            fileName: doc.originalFileName,
          });

      const integrity = inspectActualFileBytes({
        bytes: buffer,
        filename: doc.originalFileName,
        claimedMimeType: doc.mimeType,
      });
      if (integrity.integrityStatus !== "VERIFIED") {
        await prisma.companyDocument.update({
          where: { id: doc.id },
          data: {
            ...integrity,
            extractedText: null,
            aiExtractionStatus: "FAILED",
            aiExtractionError: "Source byte integrity verification failed.",
            metadata: JSON.stringify({
              ...metadata,
              extractionRevision,
              reExtractedAt: new Date().toISOString(),
              extracted: false,
              extractionStatus: "INTEGRITY_FAILED",
              integrityFailureCode: integrity.integrityFailureCode,
            }),
          },
        });
        failedFiles.push({
          name: doc.originalFileName,
          error: "Byte integrity verification failed",
          code: integrity.integrityFailureCode ?? "FILE_INTEGRITY_NOT_VERIFIED",
        });
        await options?.onDocumentDone?.(doc.id);
        continue;
      }

      const inspection = inspectOfficeContainerBytes(buffer, doc.originalFileName, integrity.contentMimeType ?? doc.mimeType);
      const rawText = inspection.kind === "json"
        ? inspection.text
        : inspection.kind === "invalid"
          ? ""
          : await extractTextFromBuffer(buffer, integrity.contentMimeType ?? doc.mimeType, doc.originalFileName);
      const extracted = limitExtractedText(rawText);
      const extractedText = extracted.text;
      const fileType = inspection.kind === "json"
        ? "JSON record"
        : getFileTypeLabel(integrity.contentMimeType ?? doc.mimeType, doc.originalFileName);
      const meaningful = isMeaningfulExtraction(extractedText);
      const quality = assessExtractionQuality(extractedText, doc.originalFileName);
      const perPage = assessExtractionQualityPerPage(extractedText);

      await prisma.companyDocument.update({
        where: { id: doc.id },
        data: {
          ...integrity,
          mimeType: integrity.contentMimeType ?? doc.mimeType,
          size: buffer.byteLength,
          extractedText: extractedText || null,
          aiExtractionStatus: meaningful ? "PENDING" : "FAILED",
          aiExtractedAt: null,
          aiExtractionError: meaningful
            ? null
            : inspection.kind === "invalid"
              ? inspection.reason
              : "No meaningful text extracted from document",
          metadata: JSON.stringify({
            ...metadata,
            fileType,
            byteInspection: inspection.kind,
            extractionRevision,
            reExtractedAt: new Date().toISOString(),
            extracted: meaningful,
            extractedChars: meaningful ? extractedText.length : 0,
            extractionStatus: meaningful ? (extracted.truncated ? "TRUNCATED" : "EXTRACTED") : "EMPTY",
            extractionScore: quality.score,
            pageStatus: perPage.pages,
            totalPages: perPage.totalDetectedPages,
            failedPages: perPage.failedPages,
            ocrPages: perPage.ocrPages,
          }),
        },
      });
      if (meaningful) reextracted += 1;
      else failedFiles.push({ name: doc.originalFileName, error: "No meaningful text extracted" });
      await options?.onDocumentDone?.(doc.id);
    } catch (error) {
      logger.error("company vault re-extraction failed", {
        documentId: doc.id,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
      failedFiles.push({ name: doc.originalFileName, error: "Processing failed" });
      await options?.onDocumentDone?.(doc.id);
    }
  }

  return { reextracted, failedFiles };
}
