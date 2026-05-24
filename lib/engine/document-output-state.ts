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
  const label = `${doc.format ?? ""} ${doc.documentType ?? ""} ${doc.reviewStatus ?? ""} ${doc.generationStatus ?? ""}`.toLowerCase();
  if (/markdown|quick_draft|draft_only/.test(label)) return "markdown";
  if (/control|placeholder|replace_with_original|original_required|not_exportable|planned/.test(label)) return "control";
  const fmt = (doc.format ?? "").toLowerCase();
  if (fmt === "pdf") return "pdf";
  if (fmt === "docx" || fmt === "doc") return "docx";
  if (fmt === "xlsx" || fmt === "xls") return "xlsx";
  if (fmt === "zip") return "zip";
  return plannedExtension(doc);
}

export function deriveDocumentOutputState(doc: DocumentLike): DocumentOutputState {
  const gen = (doc.generationStatus ?? "").toUpperCase();
  const val = (doc.validationStatus ?? "").toUpperCase();
  const rev = (doc.reviewStatus ?? "").toUpperCase();
  const want = requestedFormat(doc);

  if (gen === "SUPERSEDED" || val === "SUPERSEDED") return "SUPERSEDED";
  // REPLACE_WITH_ORIGINAL takes priority over NEEDS_REVALIDATION — a doc that
  // must use the tender-issuer's original file is ORIGINAL_REQUIRED regardless
  // of whether a reconcile also flagged it for revalidation.
  if (rev === "REPLACE_WITH_ORIGINAL" || rev === "NOT_EXPORTABLE") return "ORIGINAL_REQUIRED";
  if (val === "NEEDS_REVALIDATION") return "NEEDS_REVALIDATION";
  if (gen === "PLANNED" || want === "markdown" || want === "control") return "CONTROL_RECORD_ONLY";

  const content = (doc.fileContent ?? "").trim();
  const hasStorageContent = (doc.storagePath ?? "").trim().length > 0;

  if (content.length === 0 && !hasStorageContent) return "CONTROL_RECORD_ONLY";

  // Storage-backed docs: trust validation/review status without content-type inspection
  if (content.length === 0 && hasStorageContent) {
    if (val === "VALIDATED" && rev === "READY_FOR_EXPORT") return "READY_FOR_EXPORT";
    if (val === "VALIDATED") return "VALIDATED";
    return want === "pdf" ? "PDF_GENERATED" : "DOCX_GENERATED";
  }

  const isPdf = looksLikeBase64Pdf(content);
  const isDocx = looksLikeBase64Docx(content);

  if (want === "pdf" && !isPdf) return "PDF_CONVERSION_REQUIRED";
  if (want === "docx" && !isDocx) return "CONTROL_RECORD_ONLY";
  if ((want === "xlsx" || want === "zip") && !isDocx && !isPdf) return "CONTROL_RECORD_ONLY";

  if (isPdf) {
    if (val === "VALIDATED" && rev === "READY_FOR_EXPORT") return "READY_FOR_EXPORT";
    if (val === "VALIDATED") return "VALIDATED";
    return "PDF_GENERATED";
  }

  if (isDocx) {
    if (val === "VALIDATED" && rev === "READY_FOR_EXPORT") return "READY_FOR_EXPORT";
    if (val === "VALIDATED") return "VALIDATED";
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
