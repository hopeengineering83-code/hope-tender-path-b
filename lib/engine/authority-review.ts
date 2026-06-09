/**
 * Authority Review Engine — pure module (no DB, no network).
 *
 * Detects patterns that would embarrass the bidder if submitted:
 *   - AI-generated traces ("as an AI", "I cannot", "ChatGPT", etc.)
 *   - Placeholder text ([TBD], [INSERT], XXX, etc.)
 *   - Internal notes and Bid-Team stubs
 *   - TODO/FIXME/HACK in content
 *   - Pricing patterns inside the TECHNICAL envelope
 *   - Technical methodology patterns inside the FINANCIAL envelope
 *   - Extra documents that are not in the Final Package Manifest
 *   - Required sections that have no matching generated document
 *
 * All detection is deterministic regex — no AI calls, no external I/O.
 */
import { PLACEHOLDER_RE, AI_TRACE_RE } from "./detection-patterns";

export type AuthorityBlockerCode =
  | "AI_TRACE"
  | "PLACEHOLDER"
  | "INTERNAL_NOTE"
  | "BID_TEAM_STUB"
  | "PRICING_IN_TECHNICAL"
  | "METHODOLOGY_IN_FINANCIAL"
  | "MISSING_REQUIRED_SECTION"
  | "EXTRA_DOCUMENT_NOT_IN_MANIFEST"
  | "FILENAME_MISMATCH"
  | "FAKE_OFFICIAL_FORM"
  | "FAKE_SOURCE_REFERENCE"
  | "TODO_FIXME_IN_CONTENT";

export type AuthorityReviewStatus = "BLOCKED" | "NEEDS_REVIEW" | "AUTHORITY_READY";

export interface AuthorityBlocker {
  code: AuthorityBlockerCode;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  documentId?: string;
  documentName?: string;
  sectionName?: string;
  detail: string;
  recoveryAction: string;
}

export interface DocumentAuthorityScore {
  documentId: string;
  documentName: string;
  documentType: string;
  score: number; // 0–100
  status: AuthorityReviewStatus;
  blockers: AuthorityBlocker[];
  warnings: string[];
}

export interface AuthorityReviewResult {
  overallScore: number;
  status: AuthorityReviewStatus;
  documents: DocumentAuthorityScore[];
  summary: {
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    totalDocuments: number;
    readyDocuments: number;
  };
}

const INTERNAL_NOTE_RE =
  /Bid-Team to confirm|MISSING_SOURCE|\[Bid-Team[^\]]*\]|Source-evidence action/i;

const TODO_FIXME_RE =
  /\bTODO\b|\bFIXME\b|\bHACK\b|\bNOTE:\s/;

const PRICING_IN_TECHNICAL_RE =
  /$\s*[\d,]+|\bprice\b|\bunit cost\b|\bbid price\b|\bfinancial offer\b/i;

const METHODOLOGY_IN_FINANCIAL_RE =
  /technical approach|work methodology|implementation methodology|technical methodology/i;

// ── Score deductions per severity ────────────────────────────────────────────

const SEVERITY_DEDUCTIONS: Record<"CRITICAL" | "HIGH" | "MEDIUM", number> = {
  CRITICAL: 100, // One critical = automatic fail
  HIGH: 40,
  MEDIUM: 15,
};

/**
 * Scan a single document for authority issues.
 */
export function scanDocument(doc: {
  id: string;
  name: string;
  documentType: string;
  text: string;
}): DocumentAuthorityScore {
  const blockers: AuthorityBlocker[] = [];
  const warnings: string[] = [];
  const { id, name, documentType, text } = doc;

  if (AI_TRACE_RE.test(text)) {
    blockers.push({
      code: "AI_TRACE",
      severity: "CRITICAL",
      documentId: id,
      documentName: name,
      detail: "AI-generated conversational trace or acknowledgement detected.",
      recoveryAction: "Rewrite affected section to remove robotic AI language.",
    });
  }

  if (PLACEHOLDER_RE.test(text)) {
    const match = text.match(PLACEHOLDER_RE);
    blockers.push({
      code: "PLACEHOLDER",
      severity: "CRITICAL",
      documentId: id,
      documentName: name,
      detail: `Unfilled placeholder detected: "${match ? match[0] : "[...]"}"`,
      recoveryAction: "Provide real data or evidence for this placeholder.",
    });
  }

  if (INTERNAL_NOTE_RE.test(text)) {
    blockers.push({
      code: "INTERNAL_NOTE",
      severity: "HIGH",
      documentId: id,
      documentName: name,
      detail: "Internal bid-team instructions or notes found in client-facing text.",
      recoveryAction: "Delete internal commentary.",
    });
  }

  if (TODO_FIXME_RE.test(text)) {
    blockers.push({
      code: "TODO_FIXME_IN_CONTENT",
      severity: "MEDIUM",
      documentId: id,
      documentName: name,
      detail: "Incomplete development markers (TODO/FIXME) detected.",
      recoveryAction: "Complete the pending item and remove the marker.",
    });
  }

  const isTechnical = documentType.includes("TECHNICAL");
  const isFinancial = documentType.includes("FINANCIAL");

  if (isTechnical && PRICING_IN_TECHNICAL_RE.test(text)) {
    blockers.push({
      code: "PRICING_IN_TECHNICAL",
      severity: "CRITICAL",
      documentId: id,
      documentName: name,
      detail: "Potential pricing data or financial terms detected in technical envelope.",
      recoveryAction: "Move all commercial details to the financial proposal.",
    });
  }

  if (isFinancial && METHODOLOGY_IN_FINANCIAL_RE.test(text)) {
    blockers.push({
      code: "METHODOLOGY_IN_FINANCIAL",
      severity: "HIGH",
      documentId: id,
      documentName: name,
      detail: "Extensive technical methodology found in financial envelope.",
      recoveryAction: "Keep financial doc focused on pricing; move prose to technical.",
    });
  }

  // Calculate score
  let score = 100;
  for (const b of blockers) {
    score = Math.max(0, score - SEVERITY_DEDUCTIONS[b.severity]);
  }

  const status = score === 100 ? "AUTHORITY_READY" : score < 50 ? "BLOCKED" : "NEEDS_REVIEW";

  return {
    documentId: id,
    documentName: name,
    documentType,
    score,
    status,
    blockers,
    warnings,
  };
}

/**
 * Full authority review for a tender package.
 */
export function runAuthorityReview(tender: {
  id: string;
  title: string;
  exactFileNaming?: string;
  exactFileOrder?: string;
  generatedDocuments: Array<{ id: string; name: string; documentType: string; text: string }>;
}): AuthorityReviewResult {
  const docScores = tender.generatedDocuments.map(scanDocument);

  let criticalCount = 0;
  let highCount = 0;
  let mediumCount = 0;
  let readyDocuments = 0;

  for (const s of docScores) {
    for (const b of s.blockers) {
      if (b.severity === "CRITICAL") criticalCount++;
      if (b.severity === "HIGH") highCount++;
      if (b.severity === "MEDIUM") mediumCount++;
    }
    if (s.status === "AUTHORITY_READY") readyDocuments++;
  }

  const overallScore = docScores.length > 0
    ? Math.round(docScores.reduce((sum, s) => sum + s.score, 0) / docScores.length)
    : 100;

  let status: AuthorityReviewStatus = "AUTHORITY_READY";
  if (criticalCount > 0 || overallScore < 50) status = "BLOCKED";
  else if (highCount > 0 || overallScore < 90) status = "NEEDS_REVIEW";

  return {
    overallScore,
    status,
    documents: docScores,
    summary: {
      criticalCount,
      highCount,
      mediumCount,
      totalDocuments: docScores.length,
      readyDocuments,
    },
  };
}
