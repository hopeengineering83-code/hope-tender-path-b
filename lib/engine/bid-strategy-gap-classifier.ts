// Bid-strategy gap classifier.
//
// Distinguishes a true capability gap from a system/evidence-linking gap. The
// runtime Company Vault contract treats authenticated REVIEWED evidence and
// durable SOURCE_VERIFIED evidence as equally authoritative; draft states are
// never treated as capability proof.

export type CapabilityGapCause =
  | "NO_CAPABILITY_GAP"
  | "TRUE_CAPABILITY_GAP"
  | "EVIDENCE_LINKING_GAP"
  | "METADATA_EXTRACTION_GAP"
  | "PROVIDER_RATE_LIMIT_GAP";

export type BidStrategyGapAnalysis = {
  capabilityGapCause: CapabilityGapCause;
  systemReadinessGapsPresent: boolean;
  signals: {
    analysisRegexFallback: boolean;
    noRequirementsExtracted: boolean;
    vaultLacksReviewedExperts: boolean;
    vaultHasExpertsButNoneLinked: boolean;
    vaultHasExpertsButNoneReviewed: boolean;
    evidenceCoverageZero: boolean;
  };
  explanation: string;
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
    /** Count of runtime-authoritative experts in the Company Vault. */
    expertCount: number;
  };
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

function authoritativeTrustLevel(value: string | null | undefined): boolean {
  return value === "REVIEWED" || value === "SOURCE_VERIFIED";
}

/** Pure classifier — no side effects, no I/O. */
export function classifyBidStrategyGaps(input: GapClassifierInput): BidStrategyGapAnalysis {
  const analysisSource = (input.tender.analysisSource ?? "").toString().trim().toUpperCase();
  const analysisRegexFallback = analysisSource.length > 0 && REGEX_FALLBACK_SOURCES.has(analysisSource);
  const noRequirementsExtracted = (input.tender.requirements.length ?? 0) === 0;
  const authoritativeLinkedExperts = (input.tender.expertMatches ?? [])
    .filter((m) => authoritativeTrustLevel(m.expert.trustLevel)).length;
  const anyLinkedExperts = (input.tender.expertMatches ?? []).length;
  const vaultHasExperts = (input.company.expertCount ?? 0) > 0;
  const evidenceCoverageZero = (input.tender.evidenceCoverageRatio ?? null) === 0;

  // Historical signal property names are retained for API compatibility. Their
  // meaning is now runtime-authoritative evidence, not human REVIEWED only.
  const vaultLacksReviewedExperts = !vaultHasExperts;
  const vaultHasExpertsButNoneLinked = vaultHasExperts && anyLinkedExperts === 0;
  const vaultHasExpertsButNoneReviewed = vaultHasExperts && anyLinkedExperts > 0 && authoritativeLinkedExperts === 0;

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

  if (noRequirementsExtracted) {
    return {
      capabilityGapCause: "METADATA_EXTRACTION_GAP",
      systemReadinessGapsPresent: true,
      signals,
      explanation:
        "Capability coverage is low because no requirements have been extracted from the tender yet. " +
        "Run AI Analyze on the current canonical source revision before drawing capability conclusions.",
      inhibitDecline: true,
    };
  }
  if (analysisRegexFallback) {
    return {
      capabilityGapCause: "PROVIDER_RATE_LIMIT_GAP",
      systemReadinessGapsPresent: true,
      signals,
      explanation:
        "Capability coverage is low because the analysis source is a non-authoritative regex/deterministic fallback. " +
        "Extracted requirements may be partial; re-run AI Analyze before relying on this dimension.",
      inhibitDecline: true,
    };
  }
  if (vaultHasExpertsButNoneLinked || vaultHasExpertsButNoneReviewed) {
    return {
      capabilityGapCause: "EVIDENCE_LINKING_GAP",
      systemReadinessGapsPresent: true,
      signals,
      explanation:
        "Capability coverage is low because the Company Vault has authoritative source-backed experts but no authoritative tender-specific expert evidence is linked yet. " +
        "Run Engine or allow the current Engine job to complete; no separate human promotion step is required.",
      inhibitDecline: true,
    };
  }
  return {
    capabilityGapCause: "TRUE_CAPABILITY_GAP",
    systemReadinessGapsPresent,
    signals,
    explanation:
      "Capability coverage is low because the Company Vault lacks authoritative source-backed experts for the required disciplines. " +
      "This is a real capability gap — consider a JV/subcontract for the missing disciplines or upload genuine missing CV evidence.",
    inhibitDecline: false,
  };
}