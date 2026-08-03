// Storage-backed document quality audit.
//
// Provides safe, text-flag-only inspection for generated documents whose
// content lives in external storage (storagePath) rather than inline
// fileContent.  The audit route skips storage reads to avoid blowing
// Vercel memory on bulk calls; this module is called when a caller
// explicitly requests a deeper inspection of specific documents.
//
// Security guarantees:
//   - Never returns proposal body text.
//   - Returns boolean flags, counts, and issue codes only.
//   - Limits extraction to MAX_INSPECTION_BYTES to bound memory use.
//   - Errors from the storage adapter are caught and reported as flags;
//     they do not propagate to the API response as raw stack traces.
//
// Usage:
//   import { auditStorageBackedDocument } from "./storage-backed-document-audit";
//   const result = await auditStorageBackedDocument({ storagePath, fileName, ... });

import { getStorageAdapter } from "../storage";
import { validateFileSignature } from "./export-format-policy";
import { extractDocxVisibleText, documentHygieneIssues } from "./export-readiness";
import { assessGeneratedDocumentQuality } from "./document-quality-gate";
import { containsPricingLeakage } from "./pricing-hygiene";
import { isFinalExportCandidateDocument } from "./document-output-state";

// Max bytes to load from storage for text inspection (2 MB base64 ≈ 1.5 MB binary).
const MAX_INSPECTION_BYTES = 2_000_000;

export type StorageAuditInput = {
  documentId: string;
  documentName: string;
  exactFileName: string | null;
  documentType: string | null;
  format: string | null;
  generationStatus: string;
  validationStatus: string;
  reviewStatus: string;
  storagePath: string;
  fileContent?: string | null;
  requirements?: Array<{ title?: string | null; description?: string | null; priority?: string | null }>;
};

export type StorageAuditResult = {
  documentId: string;
  storageReadable: boolean;
  storageError: string | null;
  byteSignatureOk: boolean | null;
  fileSizeBytes: number | null;
  skippedLargeFile: boolean;
  docxVisibleTextInspectable: boolean;
  // Issue flags — no body text
  aiTraceIssue: boolean;
  placeholderIssue: boolean;
  bidTeamToConfirmIssue: boolean;
  pricingLeakageIssue: boolean;
  officialOriginalPlaceholderRisk: boolean;
  missingContentIssue: boolean;
  qualityScore: number | null;
  qualityRecommendedStatus: string | null;
  issueCodes: string[];
  wordCount: number | null;
  // Outcome
  finalExportCandidate: boolean;
  recommendedAction: string;
};

export async function auditStorageBackedDocument(
  input: StorageAuditInput,
): Promise<StorageAuditResult> {
  const fileName = input.exactFileName ?? input.documentName ?? "document";
  const finalExportCandidate = isFinalExportCandidateDocument({
    generationStatus: input.generationStatus,
    validationStatus: input.validationStatus,
    reviewStatus: input.reviewStatus,
    documentType: input.documentType,
    format: input.format,
    exactFileName: input.exactFileName,
    name: input.documentName,
  });

  // ── Attempt storage read ─────────────────────────────────────────────────
  let rawBuffer: Buffer | null = null;
  let storageReadable = false;
  let storageError: string | null = null;
  let fileSizeBytes: number | null = null;
  let skippedLargeFile = false;

  try {
    const storage = getStorageAdapter();
    const buf = await storage.getFile({
      storagePath: input.storagePath,
      fileContent: input.fileContent ?? null,
      fileName,
    });
    fileSizeBytes = buf.length;
    if (buf.length > MAX_INSPECTION_BYTES) {
      skippedLargeFile = true;
      storageReadable = true;
      // We know the file exists and is readable — just too large to inspect
    } else {
      rawBuffer = buf;
      storageReadable = true;
    }
  } catch (err) {
    storageError = err instanceof Error
      ? err.message.slice(0, 200)
      : String(err).slice(0, 200);
    storageReadable = false;
  }

  // If we couldn't read the file, return minimal flags
  if (!storageReadable) {
    return {
      documentId: input.documentId,
      storageReadable: false,
      storageError,
      byteSignatureOk: null,
      fileSizeBytes: null,
      skippedLargeFile: false,
      docxVisibleTextInspectable: false,
      aiTraceIssue: false,
      placeholderIssue: false,
      bidTeamToConfirmIssue: false,
      pricingLeakageIssue: false,
      officialOriginalPlaceholderRisk: false,
      missingContentIssue: finalExportCandidate,
      qualityScore: null,
      qualityRecommendedStatus: null,
      issueCodes: ["STORAGE_UNREADABLE"],
      wordCount: null,
      finalExportCandidate,
      recommendedAction: "Storage file is unreadable. Regenerate this document.",
    };
  }

  // If large file, return readable-but-not-inspectable result
  if (skippedLargeFile) {
    const base64 = rawBuffer === null ? null : rawBuffer.toString("base64");
    const sig = base64 ? validateFileSignature(fileName, base64) : null;
    return {
      documentId: input.documentId,
      storageReadable: true,
      storageError: null,
      byteSignatureOk: sig?.ok ?? null,
      fileSizeBytes,
      skippedLargeFile: true,
      docxVisibleTextInspectable: false,
      aiTraceIssue: false,
      placeholderIssue: false,
      bidTeamToConfirmIssue: false,
      pricingLeakageIssue: false,
      officialOriginalPlaceholderRisk: false,
      missingContentIssue: false,
      qualityScore: null,
      qualityRecommendedStatus: null,
      issueCodes: ["FILE_TOO_LARGE_FOR_INSPECTION"],
      wordCount: null,
      finalExportCandidate,
      recommendedAction: "File is too large for automated inspection. Manually review before export.",
    };
  }

  // ── Byte-signature check ────────────────────────────────────────────────
  const base64Content = rawBuffer!.toString("base64");
  const sigResult = validateFileSignature(fileName, base64Content);
  const byteSignatureOk = sigResult.ok;

  // ── Extract visible text ────────────────────────────────────────────────
  let visibleText: string | null = null;
  let docxVisibleTextInspectable = false;
  try {
    visibleText = await extractDocxVisibleText(base64Content, fileName);
    docxVisibleTextInspectable = visibleText !== null;
  } catch {
    docxVisibleTextInspectable = false;
  }

  // ── Hygiene and quality checks ──────────────────────────────────────────
  const docMeta = {
    name: input.documentName,
    exactFileName: input.exactFileName,
    documentType: input.documentType,
    format: input.format,
  };
  const hygieneTarget = visibleText ?? base64Content;
  const hygiene = documentHygieneIssues(hygieneTarget, docMeta);
  const aiTraceIssue = hygiene.some((r) => /AI\/meta-preparation/i.test(r));
  const placeholderIssue = hygiene.some((r) => /Placeholder/i.test(r));
  const pricingLeakageIssue =
    hygiene.some((r) => /pricing language/i.test(r)) ||
    (visibleText ? containsPricingLeakage(visibleText, docMeta) : false);

  const OFFICIAL_ORIGINAL_RISK_RX = /REPLACE_WITH_ORIGINAL|official.?original.?placeholder|tender.?issued.?original/i;
  const officialOriginalPlaceholderRisk = OFFICIAL_ORIGINAL_RISK_RX.test(input.reviewStatus ?? "") ||
    (visibleText ? OFFICIAL_ORIGINAL_RISK_RX.test(visibleText) : false);

  // Quality gate — only when we have visible text
  const qualityReport = visibleText
    ? assessGeneratedDocumentQuality({
        doc: docMeta,
        visibleText,
        rawFileContent: base64Content,
        hasStoragePath: true,
        requirements: input.requirements,
      })
    : null;

  const qualityScore = qualityReport?.score ?? null;
  const qualityRecommendedStatus = qualityReport?.recommendedStatus ?? null;
  const issueCodes = [
    ...(qualityReport?.issues.map((i) => i.code) ?? []),
    ...(aiTraceIssue ? ["AI_TRACE"] : []),
    ...(placeholderIssue ? ["PLACEHOLDER"] : []),
    ...(pricingLeakageIssue ? ["PRICING_LEAKAGE"] : []),
    ...(!byteSignatureOk ? ["INVALID_BYTE_SIGNATURE"] : []),
  ];
  const bidTeamToConfirmIssue = issueCodes.includes("BID_TEAM_TO_CONFIRM") ||
    (visibleText ? /Bid-Team\s+to\s+confirm/i.test(visibleText) : false);

  const wordCount = qualityReport?.wordCount ?? null;

  // Recommended action
  let recommendedAction = "No issues detected. Document appears export-ready.";
  if (!byteSignatureOk) {
    recommendedAction = "File extension does not match byte signature. Regenerate in the required format.";
  } else if (officialOriginalPlaceholderRisk) {
    recommendedAction = "Tender-issued forms must be sourced from uploaded Tender Intake files. REPLACE_WITH_ORIGINAL placeholders must not enter the ZIP.";
  } else if (qualityRecommendedStatus === "QUALITY_FAILED" || qualityRecommendedStatus === "NEEDS_REWRITE") {
    recommendedAction = `Quality gate ${qualityRecommendedStatus} (score ${qualityScore}/100). Rewrite or regenerate.`;
  } else if (bidTeamToConfirmIssue) {
    recommendedAction = '"Bid-Team to confirm" placeholder detected. Remove before export.';
  } else if (pricingLeakageIssue) {
    recommendedAction = "Pricing language detected in technical document. Remove before export.";
  } else if (aiTraceIssue) {
    recommendedAction = "AI/meta trace detected. Run auto-finalize to clean before export.";
  }

  return {
    documentId: input.documentId,
    storageReadable: true,
    storageError: null,
    byteSignatureOk,
    fileSizeBytes,
    skippedLargeFile: false,
    docxVisibleTextInspectable,
    aiTraceIssue,
    placeholderIssue,
    bidTeamToConfirmIssue,
    pricingLeakageIssue,
    officialOriginalPlaceholderRisk,
    missingContentIssue: false,
    qualityScore,
    qualityRecommendedStatus,
    issueCodes,
    wordCount,
    finalExportCandidate,
    recommendedAction,
  };
}

// Batch audit — processes multiple storage-backed documents with per-batch limits.
// Returns results in the same order as inputs.
export async function auditStorageBackedDocumentBatch(
  inputs: StorageAuditInput[],
  opts: { maxDocs?: number; maxBytesPerDoc?: number } = {},
): Promise<StorageAuditResult[]> {
  const maxDocs = Math.min(inputs.length, opts.maxDocs ?? 20);
  const results: StorageAuditResult[] = [];
  for (let i = 0; i < maxDocs; i++) {
    results.push(await auditStorageBackedDocument(inputs[i]));
  }
  return results;
}
