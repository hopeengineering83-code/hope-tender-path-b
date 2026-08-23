import { hasRestoredInlineFileContent, hasVisibleStoredFile } from "../restored-record-visibility";
import { resolveArtifactIdentity } from "./artifact-identity";

export type DocumentOutputState =
  | "CONTROL_RECORD_ONLY"
  | "DOCX_GENERATED"
  | "PDF_GENERATED"
  | "ORIGINAL_REQUIRED"
  | "PDF_CONVERSION_REQUIRED"
  | "SUPERSEDED"
  | "NEEDS_REVALIDATION"
  | "VALIDATED"
  | "ARTIFACT_IDENTITY_MISMATCH"
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
  /**
   * Persisted byte-identity metadata. Present on every release-path selection.
   * A row whose recorded byte format contradicts its name or declared format —
   * "Technical Proposal.pdf" declared DOCX holding DOCX bytes — must never be
   * an export candidate, however its statuses read.
   */
  contentMimeType?: string | null;
  detectedFormat?: string | null;
  integrityStatus?: string | null;
};

export const EXPORT_BLOCKING_STATES: readonly DocumentOutputState[] = [
  "ARTIFACT_IDENTITY_MISMATCH",
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
 * The only values the validator ever writes to GeneratedDocument.validationStatus
 * to mean "validation succeeded".
 *
 * lib/engine/validate.ts writes "PASSED" / "FAILED"; the auto-finalize
 * continuation writes "VALIDATED" / "FAILED". Everything else that column ever
 * holds is PENDING, SUPERSEDED or NEEDS_REVALIDATION.
 *
 * Exported as an array so Prisma `{ in: [...] }` filters and in-memory
 * predicates read from one definition. Four call sites previously inlined this
 * list and two of them disagreed — see isValidationPassed below.
 */
export const VALIDATION_PASSED_STATUSES = ["VALIDATED", "PASSED"] as const;

/**
 * Canonical answer to "did validation pass for this document?".
 *
 * Prefer this (or VALIDATION_PASSED_STATUSES for a database filter) over an
 * inline literal list. Two gates used to accept a four-value list that included
 * "APPROVED" and "READY_FOR_EXPORT" — reviewStatus vocabulary tested against
 * the validationStatus column, which that column has never held in any version
 * of this codebase, so those two alternatives could never match while making
 * the four gates look like they disagreed about what "validated" means.
 */
export function isValidationPassed(value?: string | null): boolean {
  const status = normalizeStatus(value);
  return (VALIDATION_PASSED_STATUSES as readonly string[]).includes(status);
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

/**
 * Does this row's identity hold up on its persisted metadata alone?
 *
 * Byte-level inspection happens on the export path; this is the metadata-only
 * guard, so a row a previous inspection already recorded as mismatched cannot
 * slip through a surface that never loads bytes.
 */
export function hasConsistentArtifactIdentity(doc: DocumentLike): boolean {
  return resolveArtifactIdentity({
    fileName: doc.exactFileName ?? doc.name ?? null,
    format: doc.format ?? null,
    contentMimeType: doc.contentMimeType ?? null,
    detectedFormat: doc.detectedFormat ?? null,
    integrityStatus: doc.integrityStatus ?? null,
  }).agrees;
}

export function isFinalExportCandidateDocument(doc: DocumentLike): boolean {
  if (NON_CANDIDATE_GENERATION_STATES.includes(normalizeStatus(doc.generationStatus))) return false;
  // A file that is not what it claims cannot be submitted: a .pdf that will not
  // open is a failed bid. Checked before any status, because statuses are
  // exactly what a mislabelled artifact used to pass on.
  if (!hasConsistentArtifactIdentity(doc)) return false;
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
  const rev = normalizeStatus(doc.reviewStatus);
  const validationPassed = isValidationPassed(doc.validationStatus);
  const want = requestedFormat(doc);

  if (gen === "SUPERSEDED" || val === "SUPERSEDED") return "SUPERSEDED";
  // A file that is not what it claims outranks every other state. Without this
  // the derived state said READY_FOR_EXPORT while isFinalExportCandidateDocument
  // said false — two surfaces disagreeing about the same row, which is how a
  // mislabelled artifact stayed plausible everywhere it was displayed.
  if (!hasConsistentArtifactIdentity(doc)) return "ARTIFACT_IDENTITY_MISMATCH";
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
    // Gap C: VALIDATED is sufficient for the automatic path (Gap 5).
    // Machine validation alone makes a routine document export-eligible.
    if (validationPassed) return "READY_FOR_EXPORT";
    return want === "pdf" ? "PDF_GENERATED" : "DOCX_GENERATED";
  }

  const isPdf = looksLikeBase64Pdf(content);
  const isDocx = looksLikeBase64Docx(content);

  if (want === "pdf" && !isPdf) return "PDF_CONVERSION_REQUIRED";
  if (want === "docx" && !isDocx) return "CONTROL_RECORD_ONLY";
  if ((want === "xlsx" || want === "zip") && !isDocx && !isPdf) return "CONTROL_RECORD_ONLY";

  if (isPdf) {
    // Gap C: VALIDATED is sufficient for the automatic path (Gap 5).
    if (validationPassed) return "READY_FOR_EXPORT";
    return "PDF_GENERATED";
  }

  if (isDocx) {
    // Gap C: VALIDATED is sufficient for the automatic path (Gap 5).
    if (validationPassed) return "READY_FOR_EXPORT";
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
    case "ARTIFACT_IDENTITY_MISMATCH":
      return "File name, declared format and actual bytes disagree. A .pdf that does not contain PDF bytes will not open for the evaluator, so it can never be exported.";
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
      return "DOCX content exists but has not passed machine validation for export.";
    case "PDF_GENERATED":
      return "PDF content exists but has not passed machine validation for export.";
    case "VALIDATED":
      return "Document validated, but review status is not READY_FOR_EXPORT yet.";
    default:
      return "Unknown state; manual review required.";
  }
}
