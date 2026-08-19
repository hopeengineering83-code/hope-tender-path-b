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
import { DOCUMENT_PLACEHOLDER_PATTERNS } from "./tender-metadata-completeness";

// Use the canonical pattern set from tender-metadata-completeness.ts so
// placeholder detection is consistent across the seven-pass gate, the
// document quality banner, and the submission plan completeness panel.
const PLACEHOLDER_PATTERNS = DOCUMENT_PLACEHOLDER_PATTERNS;

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
// tenderScopeOnly: true unless the text contains obvious off-scope signals.
//   Two complementary checks (both must pass to return true):
//
//   1. Reference-number mismatch: if the document body contains a tender
//      reference that does NOT match our own, it is out of scope.
//
//   2. Industry-sector mismatch: if the tender notes and the document text
//      each have ≥2 hits from DIFFERENT sector signature-phrase sets, the
//      document is likely written for the wrong industry. Requires both
//      signals to be strongly present (≥2 matches each) to avoid false
//      positives on documents that legitimately mention cross-sector terms.
//
//   When tenderReference and tenderNotes are both absent, we return true
//   (conservative pass) to avoid blocking legitimate documents.
//
// outlineMatchesTender: true unless the document is a recognised narrative type
//   AND has no headings at all — a heading-free wall of text does not match
//   any structured outline.  Short docs (< 100 words) are exempted because
//   cover letters and transmittal notes are legitimately heading-free.

// Industry sector fingerprints.  Each entry is a set of phrases that are
// highly distinctive to ONE sector and very unlikely to appear in another.
// Phrases are checked case-insensitively; all must be distinct enough that
// 2 simultaneous hits = confident sector identification.
const SECTOR_SIGNATURES: Record<string, RegExp[]> = {
  PHARMA: [
    /\bpharma(?:ceutical|covigilance|copeia)?\b/i,
    /\bgood\s+manufacturing\s+practice\b/i,
    /\bgmp\s+compliance\b/i,
    /\bclinical\s+trial\b/i,
    /\bdrug\s+(?:substance|product|registration)\b/i,
    /\bregulatory\s+(?:submission|dossier|authority)\b/i,
    /\bfda\s+(?:approval|guidance|submission)\b/i,
    /\bema\s+(?:approval|guidance|submission)\b/i,
    /\bactive\s+pharmaceutical\s+ingredient\b/i,
  ],
  CONSTRUCTION: [
    /\bbill\s+of\s+quantities?\b/i,
    /\bearthworks?\b/i,
    /\breinforced\s+concrete\b/i,
    /\bstructural\s+drawings?\b/i,
    /\bsite\s+(?:supervision|clearing|hoarding)\b/i,
    /\bcivil\s+works?\s+(?:contractor|package)\b/i,
    /\bpiling\b/i,
    /\bmasonr(?:y|ies)\b/i,
    /\bbrick(?:work|layer)\b/i,
    /\bformwork\b/i,
  ],
  OIL_GAS: [
    /\bhydrocarbon\b/i,
    /\bwellbore\b/i,
    /\bupstream\s+(?:operations?|sector|oil)\b/i,
    /\bdownstream\s+refiner(?:y|ies)\b/i,
    /\bfpso\b/i,
    /\bpetroleum\s+(?:engineering|exploration|production)\b/i,
    /\boil\s+(?:field|well|spill|platform)\b/i,
    /\bnatural\s+gas\s+(?:pipeline|processing|liquefied)\b/i,
  ],
  IT_SYSTEMS: [
    /\bsoftware\s+development\s+(?:lifecycle|life\s+cycle|kit)\b/i,
    /\bapi\s+integration\b/i,
    /\bdatabase\s+schema\b/i,
    /\bmicroservices?\b/i,
    /\bdevops\b/i,
    /\bcybersecurity\s+(?:assessment|audit|framework)\b/i,
    /\bcloud\s+(?:infrastructure|migration|deployment|architecture)\b/i,
    /\berp\s+(?:implementation|system|migration)\b/i,
    /\bsource\s+code\s+(?:repository|management)\b/i,
  ],
  AGRICULTURE: [
    /\bagricultural\s+(?:extension|inputs?|land|production)\b/i,
    /\bcrop\s+(?:yield|rotation|management|production)\b/i,
    /\blivestock\s+(?:management|health|production)\b/i,
    /\birrigation\s+(?:scheme|system|canal|infrastructure)\b/i,
    /\bsoil\s+(?:fertility|conservation|health|analysis)\b/i,
    /\bseed\s+(?:distribution|variety|system)\b/i,
    /\bpost-harvest\s+(?:handling|loss|storage)\b/i,
  ],
  EDUCATION: [
    /\bcurriculum\s+(?:development|design|reform)\b/i,
    /\bschool\s+(?:management|administration|enrolment|feeding)\b/i,
    /\bteacher\s+(?:training|development|recruitment|deployment)\b/i,
    /\blearning\s+(?:outcomes?|assessment|materials?)\b/i,
    /\bpedagog(?:y|ical)\b/i,
    /\bclassroom\s+(?:construction|furniture|resources?)\b/i,
    /\bstudent\s+(?:enrolment|retention|performance|attendance)\b/i,
    /\beducation\s+(?:management\s+information\s+system|system\s+reform|sector\s+plan)\b/i,
  ],
  WATER_SANITATION: [
    /\bwash\b(?!\s+and\s+dry)/i,
    /\bwater\s+(?:supply|treatment|distribution|utility|borehole|kiosk)\b/i,
    /\bsanitation\s+(?:infrastructure|facilities?|coverage|improvement)\b/i,
    /\blatrine\s+(?:construction|upgrading)\b/i,
    /\bopen\s+defecation\s+free\b/i,
    /\bdrinking\s+water\s+(?:quality|access|safety)\b/i,
    /\bsewerage\s+(?:network|system|treatment)\b/i,
    /\bhygiene\s+(?:promotion|behaviour|practice)\b/i,
  ],
  HEALTH_SERVICES: [
    /\bprimary\s+health\s+(?:care|centre|facility)\b/i,
    /\bhealth\s+(?:system\s+strengthening|facility|worker|commodity|financing)\b/i,
    /\bmaternal\s+(?:health|mortality|newborn)\b/i,
    /\bimmunisation\s+(?:programme|campaign|coverage)\b/i,
    /\bcommunity\s+health\s+(?:worker|volunteer|outreach)\b/i,
    /\bdistrict\s+health\s+(?:office|management|board)\b/i,
    /\bhealth\s+management\s+information\s+system\b/i,
  ],
  ENERGY: [
    /\brenewable\s+energy\s+(?:generation|project|system|facility)\b/i,
    /\bsolar\s+(?:pv|photovoltaic|panel|farm|mini-grid)\b/i,
    /\bwind\s+(?:turbine|farm|energy|power)\b/i,
    /\bpower\s+(?:plant|generation|transmission|distribution|sector)\b/i,
    /\belectricity\s+(?:grid|access|tariff|distribution)\b/i,
    /\boff-grid\s+(?:energy|electrification|system)\b/i,
    /\benergy\s+(?:efficiency|audit|storage|transition)\b/i,
  ],
};

function detectIndustrySectorMismatch(
  tenderNotes: string,
  docText: string,
): boolean {
  function topSector(text: string): string | null {
    let bestSector: string | null = null;
    let bestCount = 0;
    for (const [sector, patterns] of Object.entries(SECTOR_SIGNATURES)) {
      const count = patterns.filter((p) => p.test(text)).length;
      if (count >= 2 && count > bestCount) {
        bestCount = count;
        bestSector = sector;
      }
    }
    return bestSector;
  }

  const tenderSector = topSector(tenderNotes);
  if (!tenderSector) return false; // tender sector unclear → no mismatch detected
  const docSector = topSector(docText);
  if (!docSector) return false; // doc sector unclear → benefit of the doubt
  return tenderSector !== docSector;
}

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
  tenderNotes?: string | null,
): boolean {
  if (!visibleText) return true;

  // ── Check 1: reference-number mismatch ──────────────────────────────────
  if (tenderReference) {
    const normRef = tenderReference.replace(/[\s\-_/]+/g, "").toLowerCase();
    if (normRef.length >= 4) {
      const refMatches = visibleText.matchAll(/(?:ref(?:erence)?|rfp|rfq|tender\s+(?:no\.?|number|ref)|itb|eoi)\s*[:#]?\s*([\w\-/]+)/gi);
      for (const m of refMatches) {
        const found = (m[1] ?? "").replace(/[\s\-_/]+/g, "").toLowerCase();
        if (found.length >= 4 && found !== normRef && !normRef.includes(found) && !found.includes(normRef)) {
          return false;
        }
      }
    }
  }

  // ── Check 2: industry-sector mismatch ───────────────────────────────────
  // Only runs when tender notes are available and strongly identify a sector.
  // Requires ≥2 sector signature hits in BOTH sources to avoid false positives
  // on documents that incidentally mention cross-sector terminology.
  if (tenderNotes && tenderNotes.length >= 40) {
    if (detectIndustrySectorMismatch(tenderNotes, visibleText)) {
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
  /** Pre-resolved analysis source (from detectAnalysisSourceWithApproval). When
   * provided this takes precedence over the sync detection from tenderNotes, so
   * human-approved regex-fallback analyses are correctly treated as approved. */
  resolvedAnalysisSource?: import("./analysis-source").AnalysisSource | null;
};

// ── Core builder ───────────────────────────────────────────────────────────

/**
 * Builds a GeneratedDocumentGateInput from real runtime context.
 * Deliberately conservative — unknown values default to worst-case.
 */
export function buildSevenPassGateInput(ctx: SevenPassWiringContext): GeneratedDocumentGateInput {
  const text = ctx.visibleText ?? "";
  const docLabel = `${ctx.documentName ?? ""} ${ctx.exactFileName ?? ""} ${ctx.documentType ?? ""}`;

  // Analysis source mapping — prefer the pre-resolved value (which includes DB
  // approval check) over the sync notes-only detection.
  const effectiveSource = ctx.resolvedAnalysisSource ?? detectAnalysisSource({ notes: ctx.tenderNotes });
  let analysisSource: string;
  if (effectiveSource === "AI") {
    analysisSource = "AI";
  } else if (effectiveSource === "HUMAN_APPROVED_REGEX_FALLBACK") {
    analysisSource = "HUMAN_APPROVED_REGEX";
  } else if (effectiveSource === "REGEX_FALLBACK_AI_ERROR") {
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
    tenderScopeOnly: detectTenderScopeOnly(text, ctx.tenderReference, ctx.tenderNotes),
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
  return `Seven-pass gate: ${blockCount} of ${evaluation.passes.length} passes blocked. Blockers: ${blockers.join("; ")}. Action: Regenerate with reviewed evidence or remove placeholders.`;
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
