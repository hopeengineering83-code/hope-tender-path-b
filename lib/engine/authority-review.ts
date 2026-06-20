import { AI_TRACE_PATTERNS, PLACEHOLDER_PATTERNS } from "./detection-patterns";

export type AuthorityBlockerCode =
  | "AI_TRACE"
  | "PLACEHOLDER"
  | "INTERNAL_NOTE"
  | "BID_TEAM_STUB"
  | "TODO_FIXME_IN_CONTENT"
  | "PRICING_IN_TECHNICAL"
  | "METHODOLOGY_IN_FINANCIAL"
  | "EXTRA_DOCUMENT_NOT_IN_MANIFEST"
  | "MISSING_REQUIRED_SECTION"
  | "NOT_ASSESSED";

export type AuthorityReviewStatus = "NOT_ASSESSED" | "PENDING" | "BLOCKED" | "NEEDS_REVIEW" | "AUTHORITY_READY";

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
  score: number;
  status: AuthorityReviewStatus;
  blockers: AuthorityBlocker[];
  warnings: string[];
}

export interface AuthorityReviewResult {
  overallScore: number;
  status: AuthorityReviewStatus;
  blockers: AuthorityBlocker[];
  warnings: string[];
  documentScores: DocumentAuthorityScore[];
  recommendedFixes: string[];
  affectedDocumentIds: string[];
  affectedSectionNames: string[];
}

export interface DocumentInput {
  id: string;
  name: string;
  documentType: string;
  contentSummary?: string | null;
  reviewNotes?: string | null;
  exactFileName?: string | null;
}

export interface ManifestEntry {
  exactFileName: string;
  documentType: string;
}

function firstPatternMatch(patterns: RegExp[], text: string): string {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return "pattern match";
}

const INTERNAL_NOTE_RE = /Bid-Team to confirm|MISSING_SOURCE|\[Bid-Team[^\]]*\]|Source-evidence action/i;
const TODO_FIXME_RE = /\bTODO\b|\bFIXME\b|\bHACK\b|\bNOTE:\s/;
const PRICING_IN_TECHNICAL_RE = /$\s*[\d,]+|\bprice\b|\bunit cost\b|\bbid price\b|\bfinancial offer\b/i;
const METHODOLOGY_IN_FINANCIAL_RE = /technical approach|work methodology|implementation methodology|technical methodology/i;

const SEVERITY_DEDUCTIONS: Record<"CRITICAL" | "HIGH" | "MEDIUM", number> = {
  CRITICAL: 30,
  HIGH: 15,
  MEDIUM: 8,
};

function scoreStatus(score: number, hasCritical: boolean): AuthorityReviewStatus {
  if (hasCritical) return "BLOCKED";
  if (score >= 85) return "AUTHORITY_READY";
  if (score >= 60) return "NEEDS_REVIEW";
  return "BLOCKED";
}

function applyDeductions(blockers: AuthorityBlocker[]): number {
  let score = 100;
  for (const blocker of blockers) {
    score -= SEVERITY_DEDUCTIONS[blocker.severity];
  }
  return Math.max(0, score);
}

function analyseDocument(
  doc: DocumentInput,
  manifestEntries: ManifestEntry[],
): { blockers: AuthorityBlocker[]; warnings: string[] } {
  const blockers: AuthorityBlocker[] = [];
  const warnings: string[] = [];
  const text = [doc.contentSummary ?? "", doc.reviewNotes ?? ""].join(" ");
  const dtype = (doc.documentType ?? "").toUpperCase();

  if (AI_TRACE_PATTERNS.some((re) => re.test(text))) {
    blockers.push({
      code: "AI_TRACE",
      severity: "CRITICAL",
      documentId: doc.id,
      documentName: doc.name,
      detail: `AI-generated language detected: "${firstPatternMatch(AI_TRACE_PATTERNS, text)}"`,
      recoveryAction: "Remove all AI self-referential language.",
    });
  }

  if (PLACEHOLDER_PATTERNS.some((re) => re.test(text))) {
    blockers.push({
      code: "PLACEHOLDER",
      severity: "CRITICAL",
      documentId: doc.id,
      documentName: doc.name,
      detail: `Unfilled placeholder detected: "${firstPatternMatch(PLACEHOLDER_PATTERNS, text)}"`,
      recoveryAction: "Replace all placeholders with actual content.",
    });
  }

  if (INTERNAL_NOTE_RE.test(text)) {
    const match = text.match(INTERNAL_NOTE_RE);
    blockers.push({
      code: "INTERNAL_NOTE",
      severity: "CRITICAL",
      documentId: doc.id,
      documentName: doc.name,
      detail: `Internal note/stub detected: "${match?.[0] ?? "pattern match"}"`,
      recoveryAction: "Remove all internal notes.",
    });
  }

  return { blockers, warnings };
}

export function runAuthorityReview(
  documents: DocumentInput[],
  manifestEntries: ManifestEntry[],
  tenderRequiredSections: string[],
): AuthorityReviewResult {
  if (documents.length === 0 && manifestEntries.length === 0) {
      return {
          overallScore: 0,
          status: "NOT_ASSESSED",
          blockers: [{
              code: "NOT_ASSESSED",
              severity: "MEDIUM",
              detail: "Authority review not assessed — no generated documents and no verified submission plan exist.",
              recoveryAction: "Build plan and generate documents first."
          }],
          warnings: [],
          documentScores: [],
          recommendedFixes: ["Build verified submission plan and generate documents."],
          affectedDocumentIds: [],
          affectedSectionNames: []
      };
  }

  const allBlockers: AuthorityBlocker[] = [];
  const allWarnings: string[] = [];
  const documentScores: DocumentAuthorityScore[] = [];

  for (const doc of documents) {
    const { blockers, warnings } = analyseDocument(doc, manifestEntries);
    const score = applyDeductions(blockers);
    const hasCritical = blockers.some((b) => b.severity === "CRITICAL");
    const status = scoreStatus(score, hasCritical);
    documentScores.push({
      documentId: doc.id,
      documentName: doc.name,
      documentType: doc.documentType,
      score,
      status,
      blockers,
      warnings,
    });
    allBlockers.push(...blockers);
    allWarnings.push(...warnings);
  }

  const overallScore = applyDeductions(allBlockers);
  const hasAnyCritical = allBlockers.some((b) => b.severity === "CRITICAL");
  const status = scoreStatus(overallScore, hasAnyCritical);

  return {
    overallScore,
    status,
    blockers: allBlockers,
    warnings: allWarnings,
    documentScores,
    recommendedFixes: [],
    affectedDocumentIds: [],
    affectedSectionNames: []
  };
}
