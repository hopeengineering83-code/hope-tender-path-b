import { hasRestoredInlineFileContent, hasVisibleStoredFile } from "../restored-record-visibility";

export type DocumentOutputState =
  | "CONTROL_RECORD_ONLY"
  | "DOCX_GENERATED"
  | "PDF_GENERATED"
  | "ORIGINAL_REQUIRED"
  | "PDF_CONVERSION_REQUIRED"
  | "SUPERSEDED"
  | "NEEDS_REVALIDATION"
  | "VALIDATED"
  | "READY_FOR_EXPORT";

export type DocumentLike = {
  id?: string;
  name?: string | null;
  exactFileName?: string | null;
  documentType?: string | null;
  format?: string | null;
  fileContent?: string | null;
  /**
   * Metadata-only hint for dashboard/list surfaces that need to know bytes
   * exist without selecting the full inline fileContent blob. Export/download
   * paths should still pass fileContent or storagePath for byte validation.
   */
  hasInlineFileContent?: boolean | null;
  storagePath?: string | null;
  generationStatus?: string | null;
  validationStatus?: string | null;
  reviewStatus?: string | null;
};

export const EXPORT_BLOCKING_STATES: readonly DocumentOutputState[] = [
  "CONTROL_RECORD_ONLY",
  "ORIGINAL_REQUIRED",
  "PDF_CONVERSION_REQUIRED",
  "SUPERSEDED",
  "NEEDS_REVALIDATION",
];

export function normalizeStatus(value?: string | null): string {
  return (value ?? "").trim().toUpperCase();
}

/**
 * Validation statuses that count as "this document passed validation", and
 * review statuses that count as "cleared for export".
 *
 * Exported as arrays because several gates cannot call the predicates below —
 * they filter in the DATABASE (`validationStatus: { in: [...] }`). Those call
 * sites previously inlined their own literals and omitted "PASSED", which is
 * what the /validate route writes on success, so a freshly validated document
 * was counted as unvalidated and the export failed with
 * NO_EXPORT_READY_DOCUMENTS. Anything that needs the set in a query must use
 * these constants so the SQL and the predicates cannot drift apart.
 */
export const VALIDATION_PASSED_STATUSES: readonly string[] = [
  "VALIDATED",
  "PASSED",
  "APPROVED",
  "READY_FOR_EXPORT",
];

export const REVIEW_EXPORT_CLEARED_STATUSES: readonly string[] = [
  "APPROVED",
  "READY_FOR_EXPORT",
  "REPLACE_WITH_ORIGINAL",
];

export function isValidationPassed(value?: string | null): boolean {
  const status = normalizeStatus(value);
  return status === "VALIDATED" || status === "PASSED";
}

export function isReviewReadyForExport(value?: string | null): boolean {
  const s = normalizeStatus(value);
  return s === "READY_FOR_EXPORT" || s === "APPROVED";
}

export function isGenerated(value?: string | null): boolean {
  return normalizeStatus(value) === "GENERATED";
}

export function isInternalDraftDocument(doc: DocumentLike): boolean {
  const label = `${doc.name ?? ""} ${doc.exactFileName ?? ""} ${doc.documentType ?? ""} ${doc.format ?? ""} ${doc.reviewStatus ?? ""} ${doc.generationStatus ?? ""}`;
  if (/\bquick[_\s-]*draft\b/i.test(label)) return true;
  if (/\bAI\s*Proposal\s*\(\s*Quick\s*Draft\s*\)/i.test(label)) return true;
  if (/\bdraft[_\s-]*only\b/i.test(label)) return true;
  if (/\bmarkdown\b/i.test(label) && normalizeStatus(doc.reviewStatus) === "NOT_EXPORTABLE") return true;
  return false;
}

const NON_CANDIDATE_GENERATION_STATES: readonly string[] = [
  "SUPERSEDED",
  "PLANNED",
  "GENERATING",
  "FAILED",
  "QUEUED",
  "STALE",
];

export function isFinalExportCandidateDocument(doc: DocumentLike): boolean {
  if (NON_CANDIDATE_GENERATION_STATES.includes(normalizeStatus(doc.generationStatus))) return false;
  if (normalizeStatus(doc.validationStatus) === "SUPERSEDED") return false;
  const rev = normalizeStatus(doc.reviewStatus);
  if (rev === "NOT_EXPORTABLE" || rev === "REPLACE_WITH_ORIGINAL") return false;
  const fmt = normalizeStatus(doc.format);
  if (fmt === "CONTROL") return false;
  const dtype = normalizeStatus(doc.documentType ?? "");
  if (dtype === "SUBMISSION_CONTROL" || dtype === "SUBMISSION_RULES") return false;
  if (isInternalDraftDocument(doc)) return false;
  return true;
}

export function filterFinalExportCandidateDocuments<T extends DocumentLike>(docs: T[]): T[] {
  return docs.filter(isFinalExportCandidateDocument);
}

function looksLikeBase64Docx(value: string): boolean {
  if (value.length < 8) return false;
  try {
    const head = Buffer.from(value.slice(0, 12), "base64");
    return head.length >= 2 && head[0] === 0x50 && head[1] === 0x4b;
  } catch {
    return false;
  }
}

function looksLikeBase64Pdf(value: string): boolean {
  if (value.length < 8) return false;
  try {
    const head = Buffer.from(value.slice(0, 12), "base64").toString("utf8", 0, 5);
    return head === "%PDF-";
  } catch {
    return false;
  }
}

function plannedExtension(doc: DocumentLike): "pdf" | "docx" | "xlsx" | "zip" | "other" {
  const name = (doc.exactFileName ?? doc.name ?? "").toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx") || name.endsWith(".doc")) return "docx";
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return "xlsx";
  if (name.endsWith(".zip")) return "zip";
  return "other";
}

function requestedFormat(doc: DocumentLike): "pdf" | "docx" | "xlsx" | "zip" | "markdown" | "control" | "other" {
  // BUG FIX: Previously this function concatenated format + documentType +
  // reviewStatus + generationStatus into a single `label` string and ran
  // regexes against it. This caused false positives: a .pdf file with
  // documentType="PLANNED" would match the `planned` regex and return
  // "control" instead of "pdf". Now we check each field INDIVIDUALLY so
  // the format detection is not coupled to unrelated status fields.
  const fmt = (doc.format ?? "").toLowerCase();
  const dtype = (doc.documentType ?? "").toLowerCase();
  const rev = (doc.reviewStatus ?? "").toLowerCase();

  // Markdown / internal-draft detection — check format + documentType only
  if (/markdown|quick_draft|draft_only/.test(`${fmt} ${dtype}`)) return "markdown";
  // Control / non-exportable detection — check format + documentType +
  // reviewStatus, but NOT generationStatus (PLANNED generationStatus is
  // handled explicitly in deriveDocumentOutputState:141, not here).
  // NOTE: documentType="PLANNED" is NOT treated as control — documentType
  // is a category label, not a generation status. A .pdf file with
  // documentType="PLANNED" should still be classified by its format.
  if (
    fmt === "control" ||
    dtype === "submission_control" ||
    dtype === "submission_rules" ||
    dtype === "placeholder" ||
    rev === "replace_with_original" ||
    rev === "not_exportable"
  ) {
    return "control";
  }

  if (fmt === "pdf") return "pdf";
  if (fmt === "docx" || fmt === "doc") return "docx";
  if (fmt === "xlsx" || fmt === "xls") return "xlsx";
  if (fmt === "zip") return "zip";
  return plannedExtension(doc);
}

export function deriveDocumentOutputState(doc: DocumentLike): DocumentOutputState {
  const gen = normalizeStatus(doc.generationStatus);
  const val = normalizeStatus(doc.validationStatus);
  const reviewReady = isReviewReadyForExport(doc.reviewStatus);
  const rev = normalizeStatus(doc.reviewStatus);
  const validationPassed = isValidationPassed(doc.validationStatus);
  const want = requestedFormat(doc);

  if (gen === "SUPERSEDED" || val === "SUPERSEDED") return "SUPERSEDED";
  // REPLACE_WITH_ORIGINAL takes priority over NEEDS_REVALIDATION — a doc that
  // must use the tender-issuer's original file is ORIGINAL_REQUIRED regardless
  // of whether a reconcile also flagged it for revalidation.
  if (rev === "REPLACE_WITH_ORIGINAL" || rev === "NOT_EXPORTABLE") return "ORIGINAL_REQUIRED";
  if (val === "NEEDS_REVALIDATION") return "NEEDS_REVALIDATION";
  if (gen === "PLANNED" || want === "markdown" || want === "control") return "CONTROL_RECORD_ONLY";

  const content = (doc.fileContent ?? "").trim();
  const hasInlineContent = hasRestoredInlineFileContent(doc);
  const hasStorageContent = (doc.storagePath ?? "").trim().length > 0;

  if (!hasVisibleStoredFile(doc)) return "CONTROL_RECORD_ONLY";

  // Metadata-only callers may intentionally omit fileContent to avoid loading
  // large DB blobs. When bytes exist but are not loaded, trust validation/review
  // status for dashboard state; download/export routes still validate actual
  // bytes before packaging. Validation historically used both PASSED and
  // VALIDATED. Treat both as the same successful validation state so older
  // generated documents do not stay blocked after deterministic validation
  // already passed.
  if (content.length === 0 && (hasStorageContent || hasInlineContent)) {
    if (validationPassed && reviewReady) return "READY_FOR_EXPORT";
    if (validationPassed) return "VALIDATED";
    return want === "pdf" ? "PDF_GENERATED" : "DOCX_GENERATED";
  }

  const isPdf = looksLikeBase64Pdf(content);
  const isDocx = looksLikeBase64Docx(content);

  if (want === "pdf" && !isPdf) return "PDF_CONVERSION_REQUIRED";
  if (want === "docx" && !isDocx) return "CONTROL_RECORD_ONLY";
  if ((want === "xlsx" || want === "zip") && !isDocx && !isPdf) return "CONTROL_RECORD_ONLY";

  if (isPdf) {
    if (validationPassed && reviewReady) return "READY_FOR_EXPORT";
    if (validationPassed) return "VALIDATED";
    return "PDF_GENERATED";
  }

  if (isDocx) {
    if (validationPassed && reviewReady) return "READY_FOR_EXPORT";
    if (validationPassed) return "VALIDATED";
    return "DOCX_GENERATED";
  }

  return "CONTROL_RECORD_ONLY";
}

export function isExportReady(doc: DocumentLike): boolean {
  return deriveDocumentOutputState(doc) === "READY_FOR_EXPORT";
}

export function exportBlockReason(state: DocumentOutputState): string | null {
  switch (state) {
    case "READY_FOR_EXPORT":
      return null;
    case "CONTROL_RECORD_ONLY":
      return "Document is a control, placeholder, or text-only row. Generate or attach the real final file.";
    case "ORIGINAL_REQUIRED":
      return "Document is not exportable or must be replaced with the tender-issued original before export.";
    case "PDF_CONVERSION_REQUIRED":
      return "Planned extension is .pdf but the current content is not a real PDF.";
    case "SUPERSEDED":
      return "Document was superseded by a newer plan.";
    case "NEEDS_REVALIDATION":
      return "Content needs revalidation after the latest analysis or plan change.";
    case "DOCX_GENERATED":
      return "DOCX content exists but is not yet validated and review-approved for export.";
    case "PDF_GENERATED":
      return "PDF content exists but is not yet validated and review-approved for export.";
    case "VALIDATED":
      return "Document validated, but review status is not READY_FOR_EXPORT yet.";
    default:
      return "Unknown state; manual review required.";
  }
}
