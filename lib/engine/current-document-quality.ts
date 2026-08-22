// Canonical "current document quality" resolution.
//
// WHY THIS MODULE EXISTS
// ----------------------
// The Document Validator panel and the Export Readiness gate reported
// contradictory truth for the same tender: the panel showed
// "Technical Proposal.pdf — CLEAN, Warning 0, Blocked 0" while Export
// Readiness showed GENERATED_DOCUMENT_QUALITY_FAILED for that same tender.
//
// The divergence had exactly two causes, both removed here.
//
//   1. DIFFERENT DOCUMENT SETS. The panel selected
//      `generationStatus != "SUPERSEDED"`, which still admits QUEUED, STALE,
//      PLANNED, GENERATING and FAILED rows, rows whose *validationStatus* is
//      SUPERSEDED, rows marked NOT_EXPORTABLE / REPLACE_WITH_ORIGINAL,
//      CONTROL-format rows, SUBMISSION_CONTROL / SUBMISSION_RULES rows and
//      internal quick-draft rows. The gate selected
//      `filterFinalExportCandidateDocuments`. Historical, superseded, replaced,
//      outside-plan and stale rows must never enter the current readiness
//      picture, and both surfaces must agree on which rows are "current".
//
//   2. DIFFERENT QUALITY ASSESSORS. The panel ran its own inline regexes; the
//      gate ran `assessGeneratedDocumentQuality`; and a third strict validator,
//      `validateDocumentQuality` — the one the download route, the PDF finaliser
//      and auto-finalize actually enforce — ran on neither surface. Three
//      independently-written assessors cannot agree by construction.
//
// Everything that answers "is the current generated output clean?" must call
// through this module. It does NOT decide human/legal approval — machine
// validation and human review stay separate, and this module never reads or
// writes reviewStatus as an approval.

import { assessGeneratedDocumentQuality } from "./document-quality-gate";
import type { DocumentQualityReport } from "./document-quality-gate";
import { validateDocumentQuality } from "./document-quality-validator";
import type { DocumentValidationResult } from "./document-quality-validator";
import { filterFinalExportCandidateDocuments } from "./document-output-state";
import type { DocumentLike } from "./document-output-state";
import { extractDocxVisibleText } from "./export-readiness";

/**
 * Upper bound on inline content we will attempt to parse, mirroring the limit
 * the readiness gate has always applied. Larger blobs are scored from metadata
 * only rather than being pulled into memory on a render path.
 */
const MAX_INLINE_CONTENT_BYTES = 2_000_000;

export type QualityAssessableDocument = DocumentLike & {
  id?: string;
  fileContent?: string | null;
  storagePath?: string | null;
};

export type QualityRequirementInput = Array<{
  title?: string | null;
  description?: string | null;
  priority?: string | null;
}>;

/**
 * The canonical current/in-plan GeneratedDocument selection.
 *
 * Every panel and every gate that reports on "the current documents" must
 * derive its rows from this function, so a superseded or outside-plan row can
 * never be counted by one surface and ignored by another.
 */
export function selectCurrentDocuments<T extends DocumentLike>(docs: T[]): T[] {
  return filterFinalExportCandidateDocuments(docs);
}

/**
 * Resolve the text the quality gate should actually score.
 *
 * Generated DOCX files are stored base64-encoded; scoring the base64 string
 * would never match a placeholder or AI-trace pattern, so the gate would
 * silently pass every DOCX. Non-DOCX inline content is plain text/markdown and
 * is scored as-is.
 */
export async function resolveDocumentVisibleText(doc: QualityAssessableDocument): Promise<string | null> {
  const content = doc.fileContent;
  if (typeof content !== "string" || content.length === 0 || content.length >= MAX_INLINE_CONTENT_BYTES) {
    return null;
  }
  const fileName = doc.exactFileName ?? doc.name ?? "";
  if (fileName.toLowerCase().endsWith(".docx")) {
    return await extractDocxVisibleText(content, fileName);
  }
  return content;
}

/**
 * The canonical per-document narrative quality assessment (the one whose
 * QUALITY_FAILED verdict raises GENERATED_DOCUMENT_QUALITY_FAILED).
 *
 * Identical inputs must produce an identical report on every surface, so this
 * is the only place the visible-text extraction and the assessor are wired
 * together.
 */
export async function assessCurrentDocumentQuality(
  doc: QualityAssessableDocument,
  requirements: QualityRequirementInput = [],
): Promise<DocumentQualityReport> {
  const visibleText = await resolveDocumentVisibleText(doc);
  return assessGeneratedDocumentQuality({
    doc,
    visibleText,
    rawFileContent: doc.fileContent ?? null,
    hasStoragePath: Boolean(doc.storagePath && doc.storagePath.length > 0),
    requirements,
  });
}

export type CurrentDocumentQualityRow<T> = { doc: T; report: DocumentQualityReport };

/** Batch form of {@link assessCurrentDocumentQuality}. Preserves input order. */
export async function assessCurrentDocumentQualityBatch<T extends QualityAssessableDocument>(
  docs: T[],
  requirements: QualityRequirementInput = [],
): Promise<Array<CurrentDocumentQualityRow<T>>> {
  const rows: Array<CurrentDocumentQualityRow<T>> = [];
  for (const doc of docs) {
    rows.push({ doc, report: await assessCurrentDocumentQuality(doc, requirements) });
  }
  return rows;
}

export type CurrentDocumentDisplayScore = "GOOD" | "WARNING" | "BLOCKED";

/**
 * The one mapping from a quality report to the Clean / Review / Blocked
 * vocabulary the Document Validator renders.
 *
 * BLOCKED is defined as exactly the condition the export readiness gate blocks
 * on (`recommendedStatus === "QUALITY_FAILED"`), so the panel cannot show
 * "Clean" for a document the readiness gate is failing.
 */
export function qualityDisplayScore(report: DocumentQualityReport): CurrentDocumentDisplayScore {
  if (report.recommendedStatus === "QUALITY_FAILED") return "BLOCKED";
  if (report.recommendedStatus === "NEEDS_REWRITE" || report.recommendedStatus === "DRAFT_ONLY") return "WARNING";
  return "GOOD";
}

/** Count of current documents the export gate considers quality-failed. */
export function countQualityFailed(rows: Array<{ report: DocumentQualityReport }>): number {
  return rows.filter(({ report }) => report.recommendedStatus === "QUALITY_FAILED").length;
}

// ── Combined verdict ────────────────────────────────────────────────────────
//
// Two DIFFERENT machine checks decide whether a generated document may be
// exported, and a surface that runs only one of them will contradict a surface
// that runs the other:
//
//   * validateDocumentQuality (lib/engine/document-quality-validator.ts) is the
//     strict per-document validator the download route, the PDF finaliser and
//     auto-finalize enforce. It uses the canonical DOCUMENT_PLACEHOLDER /
//     AI_TRACE / boilerplate pattern sets and the canonical pricing-leakage
//     detector, and it blocks on placeholders, AI traces, empty bodies and
//     envelope mismatches.
//
//   * assessGeneratedDocumentQuality (lib/engine/document-quality-gate.ts) is
//     the narrative completeness/depth scorer whose QUALITY_FAILED verdict
//     raises the GENERATED_DOCUMENT_QUALITY_FAILED readiness blocker.
//
// Neither is a superset of the other: the strict validator catches
// MISSING_SOURCE, template slots and AI traces the narrative gate scores as
// clean, while the narrative gate catches missing sections and shallow content
// the strict validator passes. A document is only clean when BOTH agree it is
// clean, so this union is the verdict every surface must render. Combining them
// here can never weaken a gate — it can only surface a block a given surface
// previously failed to show.

export type CurrentDocumentVerdict<T> = {
  doc: T;
  /** Readiness/narrative quality report — drives GENERATED_DOCUMENT_QUALITY_FAILED. */
  report: DocumentQualityReport;
  /** Strict machine validation — the check the download/export path enforces. */
  validation: DocumentValidationResult;
  score: CurrentDocumentDisplayScore;
  /** Human-readable reasons, de-duplicated, ordered blocking-first. */
  reasons: Array<{ severity: "HIGH" | "MEDIUM"; message: string; code: string }>;
};

type VerdictReason = CurrentDocumentVerdict<unknown>["reasons"][number];

function validationReasons(validation: DocumentValidationResult): VerdictReason[] {
  const reasons: VerdictReason[] = [];
  if (validation.isEmpty) {
    reasons.push({ severity: "HIGH", code: "EMPTY_BODY", message: "Document has no usable content." });
  }
  if (validation.placeholders.length > 0) {
    reasons.push({
      severity: "HIGH",
      code: "PLACEHOLDER",
      message: `Placeholder text detected (${validation.placeholders.length} pattern(s)). These strings would be visible to evaluators.`,
    });
  }
  if (validation.aiTrace.length > 0) {
    reasons.push({
      severity: "HIGH",
      code: "AI_TRACE",
      message: `AI-trace language detected (${validation.aiTrace.length} pattern(s)).`,
    });
  }
  if (validation.envelopeMismatch) {
    reasons.push({ severity: "HIGH", code: "ENVELOPE_MISMATCH", message: validation.envelopeMismatch });
  }
  for (const warning of validation.qualityWarnings) {
    reasons.push({ severity: "MEDIUM", code: "QUALITY_WARNING", message: warning });
  }
  return reasons;
}

/**
 * Resolve the single authoritative machine verdict for one current document.
 * Every panel and gate that renders a per-document verdict must use this.
 */
export async function resolveCurrentDocumentVerdict<T extends QualityAssessableDocument>(
  doc: T,
  requirements: QualityRequirementInput = [],
): Promise<CurrentDocumentVerdict<T>> {
  const visibleText = await resolveDocumentVisibleText(doc);
  const report = assessGeneratedDocumentQuality({
    doc,
    visibleText,
    rawFileContent: doc.fileContent ?? null,
    hasStoragePath: Boolean(doc.storagePath && doc.storagePath.length > 0),
    requirements,
  });
  const validation = validateDocumentQuality({
    name: doc.name ?? "",
    documentType: doc.documentType ?? null,
    fileContent: doc.fileContent ?? null,
    storagePath: doc.storagePath ?? null,
    visibleText,
  });

  const qualityScore = qualityDisplayScore(report);
  const score: CurrentDocumentDisplayScore =
    qualityScore === "BLOCKED" || validation.status === "BLOCKED"
      ? "BLOCKED"
      : qualityScore === "WARNING" || validation.status === "WARNING" || validation.status === "NEEDS_REVIEW"
        ? "WARNING"
        : "GOOD";

  const reasons: VerdictReason[] = [];
  const seen = new Set<string>();
  const push = (reason: VerdictReason) => {
    const key = `${reason.code}:${reason.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    reasons.push(reason);
  };
  for (const reason of validationReasons(validation)) push(reason);
  for (const issue of report.issues) {
    push({ severity: issue.severity === "HIGH" ? "HIGH" : "MEDIUM", code: issue.code, message: issue.message });
  }
  reasons.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "HIGH" ? -1 : 1));

  return { doc, report, validation, score, reasons };
}

/** Batch form of {@link resolveCurrentDocumentVerdict}. Preserves input order. */
export async function resolveCurrentDocumentVerdicts<T extends QualityAssessableDocument>(
  docs: T[],
  requirements: QualityRequirementInput = [],
): Promise<Array<CurrentDocumentVerdict<T>>> {
  const verdicts: Array<CurrentDocumentVerdict<T>> = [];
  for (const doc of docs) {
    verdicts.push(await resolveCurrentDocumentVerdict(doc, requirements));
  }
  return verdicts;
}
