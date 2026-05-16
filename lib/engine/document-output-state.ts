// Document output state machine (Gap 10).
//
// PROBLEM
// ───────
// A planned submission file might require .pdf format, but the system
// might produce a .docx, or only a control record (a row in the
// GeneratedDocument table with no actual content). Until now the export
// gate looked only at (generationStatus, validationStatus, reviewStatus)
// without checking whether the content actually matches the planned
// extension. That could let a "PDF" deliverable slip through as DOCX
// or control text.
//
// FIX
// ───
// Derive a single canonical state for each generated document from the
// existing column values + content shape — NO schema change required.
// The state machine has 9 buckets, and export-readiness blocks the
// unsafe ones explicitly.
//
//   CONTROL_RECORD_ONLY      — placeholder row, no real content
//   DOCX_GENERATED           — content is a real DOCX (zip header)
//   PDF_GENERATED            — content is a real PDF (%PDF- header)
//   ORIGINAL_REQUIRED        — must be uploaded as an original (license, cert)
//   PDF_CONVERSION_REQUIRED  — planned as .pdf but content is DOCX/text
//   SUPERSEDED               — replaced by a newer plan, not for export
//   NEEDS_REVALIDATION       — content may be stale after re-analysis
//   VALIDATED                — validated; awaiting review sign-off
//   READY_FOR_EXPORT         — final state, exportable

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
  format?: string | null;
  fileContent?: string | null;
  generationStatus?: string | null;
  validationStatus?: string | null;
  reviewStatus?: string | null;
};

/** States that must NOT pass through the final-export gate. */
export const EXPORT_BLOCKING_STATES: readonly DocumentOutputState[] = [
  "CONTROL_RECORD_ONLY",
  "ORIGINAL_REQUIRED",
  "PDF_CONVERSION_REQUIRED",
  "SUPERSEDED",
  "NEEDS_REVALIDATION",
];

// ─── Content detection ───────────────────────────────────────────────

/**
 * DOCX detection — base64-encoded DOCX starts with the ZIP magic bytes
 * (0x50 0x4B, "PK"). We sniff the first decoded byte to keep it cheap;
 * a full-zip parse happens elsewhere only when we need visible text.
 */
function looksLikeBase64Docx(value: string): boolean {
  if (value.length < 8) return false;
  try {
    const head = Buffer.from(value.slice(0, 12), "base64");
    return head.length >= 2 && head[0] === 0x50 && head[1] === 0x4b;
  } catch {
    return false;
  }
}

/**
 * PDF detection — base64-encoded PDF starts with "%PDF-".
 */
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

function requestedFormat(doc: DocumentLike): "pdf" | "docx" | "xlsx" | "zip" | "other" {
  const fmt = (doc.format ?? "").toLowerCase();
  if (fmt === "pdf") return "pdf";
  if (fmt === "docx" || fmt === "doc") return "docx";
  if (fmt === "xlsx" || fmt === "xls") return "xlsx";
  if (fmt === "zip") return "zip";
  return plannedExtension(doc);
}

// ─── State derivation ────────────────────────────────────────────────

/**
 * Derive the canonical document state from the document row.
 *
 * Resolution order (first match wins — order matters):
 *   1. Explicit SUPERSEDED status on any of the three status columns
 *   2. Explicit NEEDS_REVALIDATION on validationStatus
 *   3. reviewStatus REPLACE_WITH_ORIGINAL → ORIGINAL_REQUIRED
 *   4. No fileContent at all → CONTROL_RECORD_ONLY
 *   5. Planned as .pdf but content isn't a PDF → PDF_CONVERSION_REQUIRED
 *   6. Real PDF content → PDF_GENERATED (or READY_FOR_EXPORT if review OK)
 *   7. Real DOCX content → DOCX_GENERATED (or READY_FOR_EXPORT if review OK)
 *   8. Already marked READY_FOR_EXPORT in review/validation → READY_FOR_EXPORT
 *   9. Already validated → VALIDATED
 *  10. Fallback → CONTROL_RECORD_ONLY
 */
export function deriveDocumentOutputState(doc: DocumentLike): DocumentOutputState {
  const gen = (doc.generationStatus ?? "").toUpperCase();
  const val = (doc.validationStatus ?? "").toUpperCase();
  const rev = (doc.reviewStatus ?? "").toUpperCase();

  // 1. SUPERSEDED (any column)
  if (gen === "SUPERSEDED" || val === "SUPERSEDED") return "SUPERSEDED";

  // 2. NEEDS_REVALIDATION
  if (val === "NEEDS_REVALIDATION") return "NEEDS_REVALIDATION";

  // 3. ORIGINAL_REQUIRED — explicit replacement-control records.
  if (rev === "REPLACE_WITH_ORIGINAL") return "ORIGINAL_REQUIRED";

  const content = (doc.fileContent ?? "").trim();
  const planned = plannedExtension(doc);
  const want = requestedFormat(doc);

  // 4. No content at all
  if (content.length === 0) {
    // If the row was explicitly created as a planned record, it's a
    // control row. Same fallback for any unset content state.
    return "CONTROL_RECORD_ONLY";
  }

  const isPdf = looksLikeBase64Pdf(content);
  const isDocx = looksLikeBase64Docx(content);

  // 5. Planned as PDF but content isn't PDF
  if ((planned === "pdf" || want === "pdf") && !isPdf) {
    // If the content IS a real DOCX we know we can convert, but it
    // hasn't been done yet — caller must convert before export.
    return "PDF_CONVERSION_REQUIRED";
  }

  // 6. Real PDF content
  if (isPdf) {
    if (val === "VALIDATED" && rev === "READY_FOR_EXPORT") return "READY_FOR_EXPORT";
    if (val === "VALIDATED") return "VALIDATED";
    return "PDF_GENERATED";
  }

  // 7. Real DOCX content
  if (isDocx) {
    if (val === "VALIDATED" && rev === "READY_FOR_EXPORT") return "READY_FOR_EXPORT";
    if (val === "VALIDATED") return "VALIDATED";
    return "DOCX_GENERATED";
  }

  // 8/9. Status-only signals (content is text but neither PDF nor DOCX,
  // e.g. markdown placeholders, raw HTML). Treat as control until
  // validated.
  if (val === "VALIDATED" && rev === "READY_FOR_EXPORT") return "READY_FOR_EXPORT";
  if (val === "VALIDATED") return "VALIDATED";

  // 10. Fallback — content exists but doesn't match either binary
  // format and isn't validated. Safest to keep as CONTROL_RECORD_ONLY
  // so the export gate blocks it.
  return "CONTROL_RECORD_ONLY";
}

/**
 * Convenience: should this document be allowed through the final-export gate?
 * Only READY_FOR_EXPORT passes — every other state needs human action.
 */
export function isExportReady(doc: DocumentLike): boolean {
  return deriveDocumentOutputState(doc) === "READY_FOR_EXPORT";
}

/**
 * Human-readable rationale for why a state blocks (or doesn't block) export.
 * Use this to populate the "NOT READY because…" UI messages.
 */
export function exportBlockReason(state: DocumentOutputState): string | null {
  switch (state) {
    case "READY_FOR_EXPORT":
      return null;
    case "CONTROL_RECORD_ONLY":
      return "Document is a control/placeholder row with no real content. Generate the file or attach the original.";
    case "ORIGINAL_REQUIRED":
      return "Document must be replaced with the tender-issued original (signed/stamped/certified) before export.";
    case "PDF_CONVERSION_REQUIRED":
      return "Planned extension is .pdf but the current content is not a real PDF. Convert from DOCX or attach the actual PDF before export.";
    case "SUPERSEDED":
      return "Document was superseded by a newer plan. Remove from active package or regenerate.";
    case "NEEDS_REVALIDATION":
      return "Content needs revalidation after the latest analysis/plan change.";
    case "DOCX_GENERATED":
      return "DOCX content exists but is not yet validated and review-approved for export.";
    case "PDF_GENERATED":
      return "PDF content exists but is not yet validated and review-approved for export.";
    case "VALIDATED":
      return "Document validated, but review status is not READY_FOR_EXPORT yet.";
    default:
      return "Unknown state — manual review required.";
  }
}
