// Bid-strategy gap classifier.
//
// PRODUCTION SYMPTOM
// ──────────────────
// Bid Strategy showed: win probability 38%, recommendation DECLINE,
// capability coverage 0, experience fit 92, compliance readiness 95,
// eligibility clearance 100. The 0 capability score was driven by:
//   • analysis source was REGEX_FALLBACK_AI_ERROR (unapproved),
//   • requirements had no reviewed-expert matches linked to this tender,
//   • the company vault had plenty of reviewed experts ready to link.
// In other words, the company HAS the capability — the system had not
// finished linking the evidence. Recommending DECLINE on that basis is
// dangerously misleading.
//
// WHAT THIS MODULE DOES
// ─────────────────────
// Pure classifier that consumes the same BidStrategyInput the engine
// already builds and returns a typed reason for why capability coverage
// is low, distinguishing:
//   • TRUE_CAPABILITY_GAP    — vault genuinely lacks reviewed experts
//                              for the required disciplines.
//   • EVIDENCE_LINKING_GAP   — vault has the experts; none are linked
//                              to this tender yet, or none are reviewed.
//   • METADATA_EXTRACTION_GAP — no requirements extracted yet, so the
//                              capability scorer has nothing to compare
//                              against.
//   • PROVIDER_RATE_LIMIT_GAP — analysisSource indicates regex fallback;
//                              requirements / dimensions may be partial.
//   • NO_CAPABILITY_GAP      — capability coverage is healthy; no
//                              classification required.
//
// The classifier returns the cause AND a short human-readable
// explanation suitable for the rationale field. It NEVER changes scores
// — that's the engine's job — it just labels the cause so the engine
// can refuse to collapse to DECLINE when the gap is system-readiness.

export type CapabilityGapCause =
  | "NO_CAPABILITY_GAP"
  | "TRUE_CAPABILITY_GAP"
  | "EVIDENCE_LINKING_GAP"
  | "METADATA_EXTRACTION_GAP"
  | "PROVIDER_RATE_LIMIT_GAP";

export type BidStrategyGapAnalysis = {
  /** Primary classification of why capabilityCoverage is low (NO_CAPABILITY_GAP when it isn't). */
  capabilityGapCause: CapabilityGapCause;
  /** True when ANY system-readiness signal is present, regardless of capability score. */
  systemReadinessGapsPresent: boolean;
  /** Granular flags so the UI and audit log can show every signal that fired. */
  signals: {
    analysisRegexFallback: boolean;
    noRequirementsExtracted: boolean;
    vaultLacksReviewedExperts: boolean;
    vaultHasExpertsButNoneLinked: boolean;
    vaultHasExpertsButNoneReviewed: boolean;
    evidenceCoverageZero: boolean;
  };
  /** Short, human-readable explanation suitable for the rationale paragraph. */
  explanation: string;
  /** Recommendation hint — when true, the engine MUST NOT collapse to DECLINE
   *  because the gap is system-readiness, not true capability. */
  inhibitDecline: boolean;
};

export type GapClassifierInput = {
  tender: {
    requirements: { length: number };
    expertMatches: Array<{ expert: { trustLevel: string } }>;
    analysisSource?: string | null;
    evidenceCoverageRatio?: number | null;
  };
  company: {
    expertCount: number;
  };
  /** Capability coverage score the engine just computed (0..100). */
  capabilityScore: number;
};

const REGEX_FALLBACK_SOURCES = new Set([
  "REGEX_FALLBACK",
  "REGEX_FALLBACK_AI_ERROR",
  "DETERMINISTIC_FALLBACK",
  "UNKNOWN_FALLBACK",
  "AI_PROVIDERS_EXHAUSTED",
]);

const LOW_CAPABILITY_THRESHOLD = 40;

/** Pure classifier — no side effects, no I/O. */
export function classifyBidStrategyGaps(input: GapClassifierInput): BidStrategyGapAnalysis {
  const analysisSource = (input.tender.analysisSource ?? "").toString().trim().toUpperCase();
  const analysisRegexFallback = analysisSource.length > 0 && REGEX_FALLBACK_SOURCES.has(analysisSource);
  const noRequirementsExtracted = (input.tender.requirements.length ?? 0) === 0;
  const reviewedLinkedExperts = (input.tender.expertMatches ?? []).filter((m) => m.expert.trustLevel === "REVIEWED").length;
  const anyLinkedExperts = (input.tender.expertMatches ?? []).length;
  const vaultHasExperts = (input.company.expertCount ?? 0) > 0;
  const evidenceCoverageZero = (input.tender.evidenceCoverageRatio ?? null) === 0;

  const vaultLacksReviewedExperts = !vaultHasExperts;
  const vaultHasExpertsButNoneLinked = vaultHasExperts && anyLinkedExperts === 0;
  const vaultHasExpertsButNoneReviewed = vaultHasExperts && anyLinkedExperts > 0 && reviewedLinkedExperts === 0;

  const signals = {
    analysisRegexFallback,
    noRequirementsExtracted,
    vaultLacksReviewedExperts,
    vaultHasExpertsButNoneLinked,
    vaultHasExpertsButNoneReviewed,
    evidenceCoverageZero,
  };

  const systemReadinessGapsPresent =
    analysisRegexFallback ||
    noRequirementsExtracted ||
    vaultHasExpertsButNoneLinked ||
    vaultHasExpertsButNoneReviewed ||
    (evidenceCoverageZero && vaultHasExperts);

  // Capability is healthy → no classification needed.
  if (input.capabilityScore >= LOW_CAPABILITY_THRESHOLD) {
    return {
      capabilityGapCause: "NO_CAPABILITY_GAP",
      systemReadinessGapsPresent,
      signals,
      explanation: systemReadinessGapsPresent
        ? "Capability coverage is healthy. System-readiness gaps present (see signals) but they do not change the underlying capability picture."
        : "Capability coverage is healthy and no system-readiness gaps detected.",
      inhibitDecline: false,
    };
  }

  // Capability score is LOW. Classify by priority (most specific first).
  if (noRequirementsExtracted) {
    return {
      capabilityGapCause: "METADATA_EXTRACTION_GAP",
      systemReadinessGapsPresent: true,
      signals,
      explanation:
        "Capability coverage is low because no requirements have been extracted from the tender yet. " +
        "Repair the tender analysis (run AI Analyze or use the source-grounded repair endpoint) before drawing capability conclusions.",
      inhibitDecline: true,
    };
  }
  if (analysisRegexFallback) {
    return {
      capabilityGapCause: "PROVIDER_RATE_LIMIT_GAP",
      systemReadinessGapsPresent: true,
      signals,
      explanation:
        "Capability coverage is low because the analysis source is an unapproved regex fallback. " +
        "Extracted requirements may be partial; the capability metric is unreliable. " +
        "Re-run AI Analyze when providers recover, or approve the fallback explicitly, before relying on this dimension.",
      inhibitDecline: true,
    };
  }
  if (vaultHasExpertsButNoneLinked || vaultHasExpertsButNoneReviewed) {
    return {
      capabilityGapCause: "EVIDENCE_LINKING_GAP",
      systemReadinessGapsPresent: true,
      signals,
      explanation:
        "Capability coverage is low because the company vault has reviewed experts but none are linked / reviewed for THIS tender yet. " +
        "Evidence-linking incomplete; capability unknown until coverage confirmed. " +
        "Run the matching pass or confirm reviewed-evidence suggestions before drawing a bid/no-bid conclusion.",
      inhibitDecline: true,
    };
  }
  // Vault has no reviewed experts at all → genuine capability gap.
  return {
    capabilityGapCause: "TRUE_CAPABILITY_GAP",
    systemReadinessGapsPresent,
    signals,
    explanation:
      "Capability coverage is low because the company vault lacks reviewed experts for the required disciplines. " +
      "This is a real capability gap — consider a JV / subcontract for the missing disciplines, or invest in vault depth before bidding.",
    inhibitDecline: false,
  };
}
