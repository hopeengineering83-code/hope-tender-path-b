/**
 * Document Quality Validator (Phase 3)
 *
 * Server-side implementation of the document quality validation logic.
 * Derived from DocumentValidatorPanel to ensure consistency between UI and server.
 */

export interface DocumentValidationResult {
  hasContent: boolean;
  placeholders: string[];
  aiTrace: string[];
  envelopeMismatch: string | null;
  isEmpty: boolean;
  qualityWarnings: string[];
  score: number; // 0-100
  status: "GOOD" | "WARNING" | "BLOCKED" | "NEEDS_REVIEW";
}

const PLACEHOLDER_RE = [
  /\[insert [^\]]+\]/i,
  /\{[^}]+\}/,
  /\bTODO\b/,
  /\bXXX\b/,
  /\[TBD\]/i,
  /\[NAME\]/i,
  /\[DATE\]/i,
  /\bplaceholder\b/i,
  /Bid-Team\s+to\s+confirm/i,
  /Bid-Team\s+Action/i,
  /Not\s+extracted\s*[—–-]\s*confirm\s+manually/i,
  /MISSING_SOURCE/,
  /\[CLIENT(?:\s+TO\s+BE\s+CONFIRMED)?\]/i,
];

const AI_TRACE_RE = [
  /as an ai/i,
  /language model/i,
  /\bi cannot\b/i,
  /\bas a large language\b/i,
  /I don'?t have access/i,
  /I'?m sorry,? I/i,
];

const EMPTY_SECTION_RE = /^#+\s+.+\n+(?:\n|$)/m;
const FINANCIAL_IN_TECHNICAL_RE = /total\s+price\s*(?:[:\$€£]|is\b)?\s*[\$€£]?\s*[\d,]|unit\s+price|rate\s+card|price\s+schedule|BOQ|bill\s+of\s+quantities|tax.*rate|vat.*\d/i;
const TECHNICAL_IN_FINANCIAL_RE = /methodology|work\s+plan|staffing\s+plan|technical\s+approach/i;

export function validateDocumentQuality(doc: {
  name: string;
  documentType: string | null;
  fileContent: string | null;
  storagePath: string | null;
}): DocumentValidationResult {
  const hasContent = Boolean(
    (doc.fileContent ?? "").trim().length > 0 || (doc.storagePath ?? "").trim().length > 0,
  );

  const isBase64Like = /^[A-Za-z0-9+/]{40,}={0,2}$/.test((doc.fileContent ?? "").slice(0, 500));
  const text = isBase64Like ? "" : (doc.fileContent ?? "");

  const placeholders = hasContent && text
    ? PLACEHOLDER_RE.filter((re) => re.test(text)).map((re) => re.source.replace(/[\\^$.*+?()[\]{}|]/g, "").slice(0, 40))
    : [];

  const aiTrace = hasContent && text
    ? AI_TRACE_RE.filter((re) => re.test(text)).map((re) => re.source.replace(/[\\^$.*+?()[\]{}|]/g, "").slice(0, 40))
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

  // Determine status and numeric score
  let status: DocumentValidationResult["status"] = "GOOD";
  let score = 100;

  if (placeholders.length > 0 || aiTrace.length > 0 || isEmpty || envelopeMismatch != null) {
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
  }

  return {
    hasContent,
    placeholders,
    aiTrace,
    envelopeMismatch,
    isEmpty,
    qualityWarnings,
    status,
    score
  };
}
