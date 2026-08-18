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
 *
 * SCOPE — read this before trusting a result.
 *
 * This module inspects `contentSummary` and `reviewNotes` ONLY. It never sees a
 * document's bytes or its rendered text. `contentSummary` is a short sentence
 * the app writes about a document ("Professional CV for …", "Machine export
 * repair completed for …", truncated to 500 chars on at least one path), so a
 * clean result here says nothing about what the delivered file contains. The
 * blocker names read as if they cover document content — `TODO_FIXME_IN_CONTENT`
 * says so outright — and they do not.
 *
 * Real document content IS gated, by a different pair of checks, and those are
 * the ones that carry the guarantee:
 *   - lib/engine/workflow/pdf-finalizer.ts extracts the DOCX text and runs
 *     validateDocumentQuality + hygiene + internal-artifact scans BEFORE a PDF
 *     is produced, so failing content never becomes a deliverable;
 *   - the ZIP route (app/api/tenders/[id]/download) re-extracts each DOCX's
 *     visible text and re-runs validateDocumentQuality, returning 409 on
 *     BLOCKED.
 *
 * So this module is a metadata-level layer on top of those, not a substitute
 * for them. Do not "simplify" the export path by dropping the content checks
 * because Authority Review appears to cover the same categories — it does not,
 * and the export would silently stop inspecting anything a client will read.
 */

import { AI_TRACE_PATTERNS, PLACEHOLDER_PATTERNS } from "./detection-patterns";

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
  overallScore: number; // 0–100
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

// ── Detection patterns ────────────────────────────────────────────────────────

// AI_TRACE_PATTERNS and PLACEHOLDER_PATTERNS imported from shared detection-patterns module.
// Local helper: return the first matched snippet across a pattern list.
function firstPatternMatch(patterns: RegExp[], text: string): string {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return "pattern match";
}

// "to be confirmed by bid team" is the phrase proposal-benchmark-guard's
// normalizeWeakText() substitutes in for every placeholder, TBD, TODO, template
// variable and AI refusal it cannot resolve. It is the same unresolved stub as
// "Bid-Team to confirm" — the normalizer simply emits it in two phrasings, and
// only one of them was listed here. So the rarer wording
// ("Bid-team to confirm before submission.") blocked export as a CRITICAL
// stub while the dominant wording travelled all the way into a client-facing
// tender submission untouched. Both must fail closed.
const INTERNAL_NOTE_RE =
  /Bid-Team to confirm|to be confirmed by bid[-\s]team|MISSING_SOURCE|\[Bid-Team[^\]]*\]|Source-evidence action/i;

const TODO_FIXME_RE =
  /\bTODO\b|\bFIXME\b|\bHACK\b|\bNOTE:\s/;

const PRICING_IN_TECHNICAL_RE =
  /\$\s*[\d,]+|\bprice\b|\bunit cost\b|\bbid price\b|\bfinancial offer\b/i;

const METHODOLOGY_IN_FINANCIAL_RE =
  /technical approach|work methodology|implementation methodology|technical methodology/i;

// ── Score deductions per severity ────────────────────────────────────────────

const SEVERITY_DEDUCTIONS: Record<"CRITICAL" | "HIGH" | "MEDIUM", number> = {
  CRITICAL: 30,
  HIGH: 15,
  MEDIUM: 8,
};

function scoreStatus(score: number, hasCritical: boolean): AuthorityReviewStatus {
  // Any CRITICAL blocker immediately blocks export regardless of overall score,
  // because a single unresolved CRITICAL issue (AI trace, placeholder, envelope
  // cross-contamination) would compromise the submission.
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

// ── Per-document analysis ─────────────────────────────────────────────────────

function analyseDocument(
  doc: DocumentInput,
  manifestEntries: ManifestEntry[],
): { blockers: AuthorityBlocker[]; warnings: string[] } {
  const blockers: AuthorityBlocker[] = [];
  const warnings: string[] = [];
  const text = [doc.contentSummary ?? "", doc.reviewNotes ?? ""].join(" ");
  const dtype = (doc.documentType ?? "").toUpperCase();

  // AI trace — uses shared AI_TRACE_PATTERNS for comprehensive coverage
  if (AI_TRACE_PATTERNS.some((re) => re.test(text))) {
    blockers.push({
      code: "AI_TRACE",
      severity: "CRITICAL",
      documentId: doc.id,
      documentName: doc.name,
      detail: `AI-generated language detected: "${firstPatternMatch(AI_TRACE_PATTERNS, text)}"`,
      recoveryAction: "Remove all AI self-referential language from the document content and regenerate.",
    });
  }

  // Placeholder — uses shared PLACEHOLDER_PATTERNS for comprehensive coverage
  if (PLACEHOLDER_PATTERNS.some((re) => re.test(text))) {
    blockers.push({
      code: "PLACEHOLDER",
      severity: "CRITICAL",
      documentId: doc.id,
      documentName: doc.name,
      detail: `Unfilled placeholder detected: "${firstPatternMatch(PLACEHOLDER_PATTERNS, text)}"`,
      recoveryAction: "Replace all placeholder tokens with actual content before export.",
    });
  }

  // Internal notes / Bid-Team stubs (check both INTERNAL_NOTE and BID_TEAM)
  if (INTERNAL_NOTE_RE.test(text)) {
    const match = text.match(INTERNAL_NOTE_RE);
    const isBidTeam = /Bid-Team to confirm|to be confirmed by bid[-\s]team|\[Bid-Team[^\]]*\]/i.test(text);
    blockers.push({
      code: isBidTeam ? "BID_TEAM_STUB" : "INTERNAL_NOTE",
      severity: "CRITICAL",
      documentId: doc.id,
      documentName: doc.name,
      detail: `Internal note/stub detected: "${match?.[0] ?? "pattern match"}"`,
      recoveryAction: "Remove all internal notes, Bid-Team stubs, and MISSING_SOURCE markers before export.",
    });
  }

  // TODO/FIXME
  if (TODO_FIXME_RE.test(text)) {
    const match = text.match(TODO_FIXME_RE);
    blockers.push({
      code: "TODO_FIXME_IN_CONTENT",
      severity: "HIGH",
      documentId: doc.id,
      documentName: doc.name,
      detail: `Development annotation found: "${match?.[0] ?? "pattern match"}"`,
      recoveryAction: "Remove all TODO, FIXME, HACK, and NOTE: annotations before exporting.",
    });
  }

  // Pricing in technical envelope
  if ((dtype === "TECHNICAL" || dtype === "TECHNICAL_PROPOSAL") && PRICING_IN_TECHNICAL_RE.test(text)) {
    const match = text.match(PRICING_IN_TECHNICAL_RE);
    blockers.push({
      code: "PRICING_IN_TECHNICAL",
      severity: "CRITICAL",
      documentId: doc.id,
      documentName: doc.name,
      detail: `Pricing content found in TECHNICAL document: "${match?.[0] ?? "pattern match"}"`,
      recoveryAction: "Move all pricing, unit costs, and financial offers to the FINANCIAL document.",
    });
  }

  // Methodology in financial envelope
  if ((dtype === "FINANCIAL" || dtype === "FINANCIAL_PROPOSAL") && METHODOLOGY_IN_FINANCIAL_RE.test(text)) {
    const match = text.match(METHODOLOGY_IN_FINANCIAL_RE);
    blockers.push({
      code: "METHODOLOGY_IN_FINANCIAL",
      severity: "CRITICAL",
      documentId: doc.id,
      documentName: doc.name,
      detail: `Technical methodology content found in FINANCIAL document: "${match?.[0] ?? "pattern match"}"`,
      recoveryAction: "Move technical approach/methodology content to the TECHNICAL document.",
    });
  }

  // Extra document not in manifest (filename mismatch)
  if (doc.exactFileName) {
    const inManifest = manifestEntries.some(
      (m) => m.exactFileName.toLowerCase() === doc.exactFileName!.toLowerCase(),
    );
    if (!inManifest) {
      blockers.push({
        code: "EXTRA_DOCUMENT_NOT_IN_MANIFEST",
        severity: "HIGH",
        documentId: doc.id,
        documentName: doc.name,
        detail: `Document "${doc.exactFileName}" is not listed in the Final Package Manifest.`,
        recoveryAction: "Either remove this document from the export or add it to the submission plan/manifest.",
      });
    }
  } else {
    warnings.push(`Document "${doc.name}" has no exactFileName — cannot verify manifest membership.`);
  }

  return { blockers, warnings };
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function runAuthorityReview(
  documents: DocumentInput[],
  manifestEntries: ManifestEntry[],
  tenderRequiredSections: string[],
): AuthorityReviewResult {
  const allBlockers: AuthorityBlocker[] = [];
  const allWarnings: string[] = [];
  const documentScores: DocumentAuthorityScore[] = [];

  // Per-document analysis
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

  // Missing required sections — a required section has no matching document
  // Compare on the BASE name (extension stripped) and include the document's
  // own exactFileName: generated rows are named without the extension
  // ("01-Expression-Of-Interest"), so a required section of
  // "01-Expression-Of-Interest.docx" matched neither `name` nor `documentType`
  // and a correctly generated file was reported as a CRITICAL
  // MISSING_REQUIRED_SECTION.
  const stripExtension = (value: string) => value.replace(/\.[a-z0-9]{2,5}$/i, "").trim().toLowerCase();
  for (const section of tenderRequiredSections) {
    const sectionLower = section.toLowerCase();
    const sectionBase = stripExtension(section);
    const hasMatch = documents.some((d) => {
      const candidates = [d.name, d.exactFileName ?? "", d.documentType]
        .filter((value) => value && value.trim().length > 0)
        .map((value) => value.toLowerCase());
      return candidates.some(
        (candidate) =>
          candidate.includes(sectionLower) ||
          (sectionBase.length > 0 && stripExtension(candidate).includes(sectionBase)),
      );
    });
    if (!hasMatch) {
      allBlockers.push({
        code: "MISSING_REQUIRED_SECTION",
        severity: "CRITICAL",
        sectionName: section,
        detail: `Required section "${section}" has no generated document.`,
        recoveryAction: `Generate the required document for section: "${section}" before export.`,
      });
    }
  }

  const overallScore = applyDeductions(allBlockers);
  const hasAnyCritical = allBlockers.some((b) => b.severity === "CRITICAL");
  const status = scoreStatus(overallScore, hasAnyCritical);

  const affectedDocumentIds = Array.from(
    new Set(allBlockers.filter((b) => b.documentId).map((b) => b.documentId!)),
  );
  const affectedSectionNames = Array.from(
    new Set(allBlockers.filter((b) => b.sectionName).map((b) => b.sectionName!)),
  );

  const criticalCount = allBlockers.filter((b) => b.severity === "CRITICAL").length;
  const highCount = allBlockers.filter((b) => b.severity === "HIGH").length;

  const recommendedFixes: string[] = [];
  if (criticalCount > 0) {
    recommendedFixes.push(`Fix ${criticalCount} CRITICAL blocker(s) before attempting export.`);
  }
  if (highCount > 0) {
    recommendedFixes.push(`Review and resolve ${highCount} HIGH severity issue(s).`);
  }
  if (status === "AUTHORITY_READY") {
    recommendedFixes.push("All authority review checks pass. Document is ready for final export.");
  }

  return {
    overallScore,
    status,
    blockers: allBlockers,
    warnings: allWarnings,
    documentScores,
    recommendedFixes,
    affectedDocumentIds,
    affectedSectionNames,
  };
}
