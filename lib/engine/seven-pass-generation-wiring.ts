// Seven-pass generation gate — wiring adapter.
//
// Bridges real generated-document / tender context to the pure
// evaluateSevenPassGenerationGate() function so the gate can be enforced
// in every code path that might flip a document to PASSED / VALIDATED /
// READY_FOR_EXPORT:
//
//   - app/api/tenders/[id]/auto-finalize/route.ts
//   - app/api/admin/generated-proposals/reassess/route.ts  (supplemental)
//   - any future path that marks a document PASSED/READY
//
// Deliberately dependency-light and synchronous so callers don't have
// to await a chain of DB calls just to get a safety decision.
//
// Async helpers (loadSevenPassEvidenceCounts) are provided separately for
// callers that can afford an extra DB round-trip.

import { evaluateSevenPassGenerationGate, sevenPassBlocksFinalApproval, type GeneratedDocumentGateInput, type SevenPassEvaluation } from "./seven-pass-generation";
import { detectAnalysisSource } from "./analysis-source";
import { containsPricingLeakage } from "./pricing-hygiene";

// ── Placeholder patterns ───────────────────────────────────────────────────

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /Bid-Team\s+to\s+confirm/i,
  /Bid-Team\s+Action/i,
  /Source-evidence\s+action/i,
  /\bTBC\b/,
  /\bTBD\b/,
  /\bTODO\b/,
  /to\s+be\s+confirmed/i,
  /\bfill\s+in\b/i,
  /\bPLACEHOLDER\b/i,
  /\[INSERT[^\]]*\]/i,
  /\[CLIENT\s+TO\s+BE\s+CONFIRMED[^\]]*\]/i,
  /\[(insert|add here|fill|name of|date here|signature here|stamp here|tbd|tbc)[^\]]*\]/i,
  /PLACEHOLDER FOR TENDER-ISSUED ORIGINAL/i,
];

// ── AI / meta trace patterns ───────────────────────────────────────────────

const AI_TRACE_PATTERNS: RegExp[] = [
  /\bChatGPT\b/i,
  /\bOpenAI\b/i,
  /\bClaude\b(?:\s+AI|\s+by\s+Anthropic)?/i,
  /\bas\s+an\s+AI\b/i,
  /\bI\s+cannot\b/i,
  /\bI\s+don't\s+have\s+access\b/i,
  /\bI\s+do\s+not\s+have\s+access\b/i,
  /\bgenerated\s+by\s+AI\b/i,
  /\blanguage\s+model\b/i,
  /\bAI\s+language\s+model\b/i,
  /\bprompt\s+(?:instruction|template|engineering)\b/i,
  /\bdraft\s+note\b/i,
  /\bsubmission\s+note\b/i,
  /\bregex\s+fallback\b/i,
  /\bdeterministic\s+fallback\b/i,
  /\bAI\s+provider\b/i,
  /\bBenchmark\s+trace\b/i,
  /\bpreparation\s+trace\b/i,
];

// ── Official-original document patterns ───────────────────────────────────
// These must never be generated and marked READY_FOR_EXPORT; they require
// the actual signed/stamped/certified original.

const OFFICIAL_ORIGINAL_LABEL_PATTERNS: RegExp[] = [
  /\bbid\s+form\b/i,
  /\btender\s+form\b/i,
  /\bdeclaration\s+(?:of|form)\b/i,
  /\bundertaking\b/i,
  /\bintegrity\s+pact\b/i,
  /\bbid\s+bond\b/i,
  /\bbank\s+statement\b/i,
  /\btin\s+cert/i,
  /\bvat\s+cert/i,
  /\btax\s+clearance\b/i,
  /\baudited\s+financial\b/i,
  /\btrade\s+license\b/i,
  /\bbusiness\s+licen/i,
  /\bregistration\s+certificate\b/i,
];

// ── Technical-document classification ─────────────────────────────────────

function isTechnicalDocument(docLabel: string): boolean {
  return /\btechnical\b|\bmethodology\b|\bwork\s+plan\b|\bapproach\b|\bscope\b|\bcv\b|\bpersonnel\b|\bproject.*experience\b|\bcompany.*profile\b/i.test(docLabel);
}

function isFinancialDocument(docLabel: string): boolean {
  return /\bfinancial\b|\bcommercial\b|\bprice\b|\brate\s+card\b|\bboq\b|\bbill\s+of\s+quantities?\b/i.test(docLabel);
}

// ── Structural proxy checks ────────────────────────────────────────────────
//
// tenderScopeOnly: true unless the text contains obvious off-scope signals —
//   a different tender reference number or a known competing-tender phrase.
//   We cannot detect arbitrary scope drift without AI, so we only catch the
//   most obvious case: the document body contains a reference number that does
//   NOT match the tender's own reference.  When tenderReference is not
//   available, we conservatively return true (pass the check) to avoid
//   blocking legitimate documents.
//
// outlineMatchesTender: true unless the document is a recognised narrative type
//   AND has no headings at all — a heading-free wall of text does not match
//   any structured outline.  Short docs (< 100 words) are exempted because
//   cover letters and transmittal notes are legitimately heading-free.

function detectOutlineMatchesTender(
  docLabel: string,
  visibleText: string,
): boolean {
  const isNarrative = /technical\s+proposal|methodology|work\s+plan|approach\s+(?:to|and)|implementation\s+plan/i.test(docLabel);
  if (!isNarrative) return true; // non-narrative docs don't need a structured outline

  if (!visibleText || visibleText.trim().length === 0) return true; // no text → gate skips

  const wordCount = visibleText.split(/\s+/).filter(Boolean).length;
  if (wordCount < 100) return true; // short doc — heading-free is acceptable

  // Check for at least one heading signal in the first 3 000 chars
  const sample = visibleText.slice(0, 3000);
  const hasHeading =
    /^#{1,6}\s+\S/m.test(sample) ||
    /^[A-Z][A-Z0-9 \-,'/&]{4,}$/m.test(sample) ||
    /^\d+\.\s+\S/m.test(sample) ||
    /^(?:section|chapter|annex|appendix)\s+[0-9A-Z]/im.test(sample);

  return hasHeading;
}

function detectTenderScopeOnly(
  visibleText: string,
  tenderReference?: string | null,
): boolean {
  // Without a reference number we cannot detect scope leakage — pass by default.
  if (!tenderReference || !visibleText) return true;

  // Normalise: strip whitespace, lowercase, remove common separators
  const normRef = tenderReference.replace(/[\s\-_/]+/g, "").toLowerCase();
  if (normRef.length < 4) return true; // too short to match reliably

  // Look for a DIFFERENT reference pattern in the document body.
  // Heuristic: find text like "Ref:", "RFP:", "Tender No." followed by a token
  // that looks like a tender reference and is clearly different from ours.
  const refMatches = visibleText.matchAll(/(?:ref(?:erence)?|rfp|rfq|tender\s+(?:no\.?|number|ref)|itb|eoi)\s*[:#]?\s*([\w\-/]+)/gi);
  for (const m of refMatches) {
    const found = (m[1] ?? "").replace(/[\s\-_/]+/g, "").toLowerCase();
    if (found.length >= 4 && found !== normRef && !normRef.includes(found) && !found.includes(normRef)) {
      // Found a reference that doesn't match ours — possible scope leakage
      return false;
    }
  }
  return true;
}

// ── Count helpers ──────────────────────────────────────────────────────────

function countPatternMatches(text: string, patterns: RegExp[]): number {
  let count = 0;
  for (const rx of patterns) {
    // Reset lastIndex on global patterns to avoid cross-call state
    if (rx.global) rx.lastIndex = 0;
    if (rx.test(text)) count += 1;
  }
  return count;
}

// ── Input type ─────────────────────────────────────────────────────────────

export type SevenPassWiringContext = {
  /** tender.notes — used to detect analysis source */
  tenderNotes?: string | null;
  /** Cleaned / visible text of the generated document */
  visibleText?: string | null;
  /** Number of REVIEWED experts selected for this tender */
  reviewedExpertCount?: number;
  /** Number of REVIEWED projects selected for this tender */
  reviewedProjectCount?: number;
  /** Number of EXPERT-type requirements in the tender */
  requiredExpertCount?: number;
  /** Number of PROJECT_EXPERIENCE-type requirements in the tender */
  requiredProjectCount?: number;
  /** Total mandatory requirements (used as fallback for coverage ratio) */
  totalMandatoryRequirements?: number;
  /** Mandatory requirements with source confidence > 0 (used for coverage proxy) */
  sourcedMandatoryRequirements?: number;
  /** document type label (name + exactFileName + documentType) */
  documentType?: string | null;
  documentName?: string | null;
  exactFileName?: string | null;
  /** reviewStatus of the document before this finalization */
  currentReviewStatus?: string | null;
  /** Self-review score 0..100 if available */
  selfReviewScore?: number | null;
  /** Whether the content was produced by the deterministic fallback */
  deterministicFallbackUsed?: boolean;
  /** AI provider used (for surfacing in metadata) */
  providerUsed?: string | null;
  /** tender.reference — used for tenderScopeOnly proxy check */
  tenderReference?: string | null;
};

// ── Core builder ───────────────────────────────────────────────────────────

/**
 * Builds a GeneratedDocumentGateInput from real runtime context.
 * Deliberately conservative — unknown values default to worst-case.
 */
export function buildSevenPassGateInput(ctx: SevenPassWiringContext): GeneratedDocumentGateInput {
  const text = ctx.visibleText ?? "";
  const docLabel = `${ctx.documentName ?? ""} ${ctx.exactFileName ?? ""} ${ctx.documentType ?? ""}`;

  // Analysis source mapping
  const rawSource = detectAnalysisSource({ notes: ctx.tenderNotes });
  let analysisSource: string;
  if (rawSource === "AI") {
    analysisSource = "AI";
  } else if (rawSource === "HUMAN_APPROVED_REGEX_FALLBACK") {
    analysisSource = "HUMAN_APPROVED_REGEX";
  } else if (rawSource === "REGEX_FALLBACK_AI_ERROR") {
    analysisSource = "REGEX_FALLBACK";
  } else {
    // UNKNOWN — conservative: block until source confirmed
    analysisSource = "UNKNOWN";
  }

  // Evidence coverage ratio
  const reviewedEvidence = (ctx.reviewedExpertCount ?? 0) + (ctx.reviewedProjectCount ?? 0);
  const requiredEvidence = (ctx.requiredExpertCount ?? 0) + (ctx.requiredProjectCount ?? 0);

  let evidenceCoverageRatio: number;
  if (requiredEvidence > 0) {
    evidenceCoverageRatio = Math.min(1, reviewedEvidence / requiredEvidence);
  } else if (ctx.totalMandatoryRequirements != null && ctx.totalMandatoryRequirements > 0) {
    // Fallback proxy: ratio of source-referenced mandatory requirements
    const sourced = ctx.sourcedMandatoryRequirements ?? 0;
    evidenceCoverageRatio = sourced / ctx.totalMandatoryRequirements;
  } else {
    // No requirements info — treat as 0 (conservative)
    evidenceCoverageRatio = 0;
  }

  // Trust levels: assume REVIEWED for each reviewed evidence item,
  // UNREVIEWED for anything not explicitly reviewed
  const selectedEvidenceTrustLevels: string[] = [
    ...Array(Math.max(0, ctx.reviewedExpertCount ?? 0)).fill("REVIEWED"),
    ...Array(Math.max(0, ctx.reviewedProjectCount ?? 0)).fill("REVIEWED"),
  ];
  if (selectedEvidenceTrustLevels.length === 0) {
    selectedEvidenceTrustLevels.push("UNREVIEWED");
  }

  // Placeholder count
  const placeholderCount = text ? countPatternMatches(text, PLACEHOLDER_PATTERNS) : 0;

  // AI trace count
  const aiTraceCount = text ? countPatternMatches(text, AI_TRACE_PATTERNS) : 0;

  // Pricing leakage — only applies to technical docs
  const isTechnical = isTechnicalDocument(docLabel);
  const isFinancial = isFinancialDocument(docLabel);
  let pricingLeakageCount = 0;
  if (isTechnical && !isFinancial && text) {
    const docMeta = { name: ctx.documentName ?? "", exactFileName: ctx.exactFileName ?? null, documentType: ctx.documentType ?? null, format: "DOCX" as const };
    pricingLeakageCount = containsPricingLeakage(text, docMeta) ? 1 : 0;
  }

  // Official-original risk — from document label
  const officialOriginalRiskCount = countPatternMatches(docLabel.toLowerCase(), OFFICIAL_ORIGINAL_LABEL_PATTERNS);

  // Technical/financial separation
  let technicalFinancialSeparationOk: boolean;
  if (isTechnical && pricingLeakageCount > 0) {
    technicalFinancialSeparationOk = false;
  } else {
    technicalFinancialSeparationOk = true;
  }

  // Unsupported claims: use conservative proxy — if reviewed evidence = 0 and
  // text contains experience/capacity claims, flag as unsupported
  let unsupportedClaimCount = 0;
  if (reviewedEvidence === 0 && text && /\b(over \d+|more than \d+|awarded|delivered|completed|extensive experience|proven track record)\b/i.test(text)) {
    unsupportedClaimCount = 1;
  }

  // Deterministic fallback
  const deterministicFallbackUsed = ctx.deterministicFallbackUsed ?? false;

  // Self-review score: pass null when the caller has not computed a score.
  // The gate treats null as "not yet evaluated" and skips the threshold check —
  // other passes (placeholders, AI traces, evidence, pricing) still block.
  // Passing 0 would permanently block every document; null is the correct
  // sentinel for "score not available in this code path."
  const selfReviewScore: number | null = ctx.selfReviewScore != null ? ctx.selfReviewScore : null;

  return {
    analysisSource,
    evidenceCoverageRatio,
    reviewedEvidenceCount: reviewedEvidence,
    requiredEvidenceCount: Math.max(1, requiredEvidence), // avoid gate treating "no requirements" as trivially passing
    unsupportedClaimCount,
    placeholderCount,
    aiTraceCount,
    pricingLeakageCount,
    officialOriginalRiskCount,
    technicalFinancialSeparationOk,
    tenderScopeOnly: detectTenderScopeOnly(text, ctx.tenderReference),
    outlineMatchesTender: detectOutlineMatchesTender(docLabel, text),
    selectedEvidenceTrustLevels,
    selfReviewScore,
    deterministicFallbackUsed,
    providerUsed: ctx.providerUsed,
  };
}

// ── Status mapper ──────────────────────────────────────────────────────────

export type SevenPassDocumentStatusUpdate = {
  validationStatus: string;
  reviewStatus: string;
  reviewNotesSuffix: string;
};

/**
 * Maps a SevenPassEvaluation to conservative document status fields.
 * Only ever BLOCKS (never silently upgrades a document that would otherwise
 * be PENDING). The returned status replaces the caller's own status decision
 * when the gate blocks.
 */
export function applySevenPassGateToDocumentState(
  evaluation: SevenPassEvaluation,
  /** The status the caller was about to set (caller's own decision) */
  callerIntendedStatus: { validationStatus: string; reviewStatus: string },
): SevenPassDocumentStatusUpdate {
  if (evaluation.finalApprovalAllowed) {
    return {
      validationStatus: callerIntendedStatus.validationStatus,
      reviewStatus: callerIntendedStatus.reviewStatus,
      reviewNotesSuffix: " [seven-pass gate: PASSED]",
    };
  }

  const blockerSummary = evaluation.blockers.slice(0, 3).join("; ");
  const failedPasses = evaluation.passes.filter((p) => p.status === "BLOCKED").map((p) => p.label).join(", ");
  const notesSuffix = ` [seven-pass gate: BLOCKED — ${evaluation.blockers.length} blocker(s); failed pass(es): ${failedPasses}; ${blockerSummary}]`;

  return {
    validationStatus: evaluation.recommendedValidationStatus,
    reviewStatus: "NEEDS_REVIEW",
    reviewNotesSuffix: notesSuffix,
  };
}

// ── Summary text ───────────────────────────────────────────────────────────

/**
 * Returns a short, non-sensitive summary suitable for reviewNotes or API
 * responses. Does NOT include proposal body text.
 */
export function summarizeSevenPassForReviewNotes(evaluation: SevenPassEvaluation): string {
  const passCount = evaluation.passes.filter((p) => p.status === "PASSED").length;
  const blockCount = evaluation.passes.filter((p) => p.status === "BLOCKED").length;
  const blockers = evaluation.blockers.slice(0, 4);
  if (evaluation.finalApprovalAllowed) {
    return `Seven-pass gate: all ${passCount} passes cleared. Recommended for final approval.`;
  }
  return `Seven-pass gate: ${blockCount} of ${evaluation.passes.length} passes blocked. Blockers: ${blockers.join("; ")}. Action: Regenerate with reviewed evidence, remove placeholders, or attach official original.`;
}

// ── Convenience wrapper ────────────────────────────────────────────────────

/**
 * Returns true when the seven-pass gate blocks final approval for this
 * document. Conservative: defaults to blocking when context is incomplete.
 */
export function shouldBlockFinalApprovalBySevenPassGate(ctx: SevenPassWiringContext): boolean {
  return sevenPassBlocksFinalApproval(buildSevenPassGateInput(ctx));
}

/**
 * Full evaluation with metadata — prefer this over the boolean version when
 * you need to store the result in reviewNotes.
 */
export function evaluateSevenPassForDocument(ctx: SevenPassWiringContext): SevenPassEvaluation {
  return evaluateSevenPassGenerationGate(buildSevenPassGateInput(ctx));
}
