/**
 * Document Quality Validator (Phase 3)
 *
 * Server-side implementation of the document quality validation logic.
 * Derived from DocumentValidatorPanel to ensure consistency between UI and server.
 */
import { PLACEHOLDER_PATTERNS, AI_TRACE_PATTERNS, GENERIC_BOILERPLATE_PATTERNS } from "./detection-patterns";

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
const FINANCIAL_IN_TECHNICAL_RE = /total\s+price\s*(?:[:\$€£]|is\b)?\s*[\$€£]?\s*[\d,]|unit\s+price|rate\s+card|price\s+schedule|BOQ|bill\s+of\s+quantities|\btax\b.{0,24}\brate\b|\bvat\b.{0,24}\d/i;
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

  const isBase64Like = /^[A-Za-z0-9+/]{40,}={0,2}$/.test((doc.fileContent ?? "").slice(0, 500));
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
  if (text && (dtype === "TECHNICAL" || dtype === "TECHNICAL_PROPOSAL") && FINANCIAL_IN_TECHNICAL_RE.test(text)) {
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
