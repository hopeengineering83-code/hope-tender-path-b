/**
 * Document Quality Validator (Phase 3)
 *
 * Server-side implementation of the document quality validation logic.
 * Derived from DocumentValidatorPanel to ensure consistency between UI and server.
 */
import { looksLikeEncodedBytes } from "./encoded-content";
import { PLACEHOLDER_PATTERNS, AI_TRACE_PATTERNS, GENERIC_BOILERPLATE_PATTERNS } from "./detection-patterns";
import { containsPricingLeakage } from "./pricing-hygiene";

export interface DocumentValidationResult {
  hasContent: boolean;
  placeholders: string[];
  aiTrace: string[];
  boilerplateHits: string[];
  envelopeMismatch: string | null;
  isEmpty: boolean;
  qualityWarnings: string[];
  score: number; // 0-100
  status: "GOOD" | "WARNING" | "BLOCKED" | "NEEDS_REVIEW";
}

const EMPTY_SECTION_RE = /^#+\s+.+\n+(?:\n|$)/m;
// Pricing leakage is decided by lib/engine/pricing-hygiene.ts, the same
// detector the export-readiness gate uses. This module used to carry its own
// regex, and the two disagreed on real documents.
//
// The regex included /\bvat\b.{0,24}\d/i, which matched the company's own
// "VAT Reg. No.: 00098765" — a registration number that appears in the
// letterhead of every document the app produces, and on many is legally
// required. A technical proposal containing no price at all was refused at
// download with "Financial pricing content detected in a TECHNICAL document",
// while documentHygieneIssues() found nothing wrong with the identical text.
// The canonical detector reads sentence by sentence and exempts identity,
// quoted requirements and no-price assurances, so it does not confuse a tax
// identifier with a quoted fee.
const TECHNICAL_IN_FINANCIAL_RE = /methodology|work\s+plan|staffing\s+plan|technical\s+approach/i;

export function validateDocumentQuality(doc: {
  name: string;
  documentType: string | null;
  fileContent: string | null;
  storagePath: string | null;
  /**
   * Pre-extracted visible text from the document content. When provided,
   * this is used instead of fileContent for regex-based quality checks
   * (placeholders, AI traces, boilerplate, envelope mismatch). Callers
   * that have base64 DOCX/PDF content should extract the visible text
   * first (e.g. via extractDocxVisibleText) and pass it here — otherwise
   * the quality checks are silently skipped because base64 content does
   * not look like plain text.
   */
  visibleText?: string | null;
}): DocumentValidationResult {
  const hasContent = Boolean(
    (doc.fileContent ?? "").trim().length > 0 || (doc.storagePath ?? "").trim().length > 0,
  );

  // One predicate, shared with export-readiness. This test used to live here
  // alone; the two hygiene paths in export-readiness had no equivalent and so
  // scanned encoded bytes, which randomly rejected clean documents. See
  // lib/engine/encoded-content.ts.
  const isBase64Like = looksLikeEncodedBytes(doc.fileContent);
  // If the caller pre-extracted visible text, use it. Otherwise fall back
  // to fileContent only when it is NOT base64 (base64 content would cause
  // false negatives — the regex checks would run against base64 gibberish
  // and never match, silently skipping placeholder/AI-trace detection).
  // Per spec rule 6: validation must not approve empty content, placeholder
  // content, AI traces, pricing leakage, or wrong envelope files.
  const text = doc.visibleText ?? (isBase64Like ? "" : (doc.fileContent ?? ""));

  const placeholders = hasContent && text
    ? PLACEHOLDER_PATTERNS.filter((re) => re.test(text)).map((re) => re.source.replace(/[\\^$.*+?()[\]{}|]/g, "").slice(0, 40))
    : [];

  const aiTrace = hasContent && text
    ? AI_TRACE_PATTERNS.filter((re) => re.test(text)).map((re) => re.source.replace(/[\\^$.*+?()[\]{}|]/g, "").slice(0, 40))
    : [];

  const boilerplateHits = hasContent && text
    ? GENERIC_BOILERPLATE_PATTERNS.filter((re) => re.test(text)).map((re) => re.source.replace(/[\\^$.*+?()[\]{}|]/g, "").slice(0, 40))
    : [];

  const dtype = (doc.documentType ?? "").toUpperCase();
  let envelopeMismatch: string | null = null;
  if (text && (dtype === "TECHNICAL" || dtype === "TECHNICAL_PROPOSAL") && containsPricingLeakage(text, { name: doc.name, exactFileName: null, documentType: doc.documentType, format: null } as never)) {
    envelopeMismatch = "Financial pricing content detected in a TECHNICAL document";
  } else if (text && (dtype === "FINANCIAL" || dtype === "FINANCIAL_PROPOSAL") && TECHNICAL_IN_FINANCIAL_RE.test(text)) {
    envelopeMismatch = "Technical methodology content detected in a FINANCIAL document";
  }

  const isEmpty = !hasContent || (text.length > 0 && text.trim().length < 50);
  const qualityWarnings: string[] = [];
  if (text && EMPTY_SECTION_RE.test(text)) qualityWarnings.push("Empty section headings detected");
  if (text && text.length > 0 && text.length < 200) qualityWarnings.push("Document content is very short — may be incomplete");
  if (boilerplateHits.length >= 3) qualityWarnings.push(`High generic boilerplate density detected (${boilerplateHits.length} hits)`);

  // Determine status and numeric score
  let status: DocumentValidationResult["status"] = "GOOD";
  let score = 100;

  if (placeholders.length > 0 || aiTrace.length > 0 || isEmpty || envelopeMismatch != null || boilerplateHits.length >= 5) {
    status = "BLOCKED";
    score = 30; // Default blocked score
  } else if (qualityWarnings.length > 0) {
    status = "WARNING";
    score = 65;
  }

  // Adjust score based on granular findings
  if (status === "BLOCKED") {
    if (isEmpty) score = 0;
    else if (aiTrace.length > 0) score = 20;
    else if (placeholders.length > 0) score = 35;
    else if (boilerplateHits.length >= 5) score = 40;
  }

  return {
    hasContent,
    placeholders,
    aiTrace,
    boilerplateHits,
    envelopeMismatch,
    isEmpty,
    qualityWarnings,
    status,
    score
  };
}
