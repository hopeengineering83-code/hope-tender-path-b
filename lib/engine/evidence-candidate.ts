/**
 * Evidence-First Tender Facts — Candidate Model
 *
 * Do not write regex, parser, or AI guesses directly as final canonical
 * Tender facts. Instead, produce candidates that must be grounded in source
 * evidence before becoming canonical.
 *
 * Every candidate must contain:
 * - candidate type (regex, ai, manual)
 * - normalized value
 * - original displayed value
 * - candidate status (CANDIDATE, GROUNDED, CONFIRMED, NEEDS_REVIEW, REJECTED, STALE, HISTORICAL)
 * - confidence (0-1)
 * - TenderFile ID
 * - page number
 * - exact quote
 * - source-content hash
 * - extraction/AI source
 * - validation result
 * - competing-candidate indicator
 * - created date
 * - stale status where applicable
 *
 * Rules:
 * 1. Auto-confirm only when a valid value has one strong source-evidence path.
 * 2. Conflicting valid candidates must become NEEDS_REVIEW.
 * 3. Invalid values must never become canonical facts.
 * 4. When a field value changes, stale evidence for the old value must be cleared.
 * 5. A fact cannot be grounded using inactive/deleted files, pages outside range,
 *    missing quotes, ambiguous quotes, or quotes not in extracted text.
 */

export type CandidateType = "regex" | "ai" | "manual" | "override";

export type CandidateStatus =
  | "CANDIDATE"     // Extracted but not yet verified
  | "GROUNDED"      // Has valid source evidence (file + page + quote)
  | "CONFIRMED"     // Human-confirmed or auto-confirmed with strong evidence
  | "NEEDS_REVIEW"  // Conflicting candidates or uncertain evidence
  | "REJECTED"      // Invalid value, not usable
  | "STALE"         // Value changed, old evidence no longer applies
  | "HISTORICAL";   // Superseded by a newer candidate

export type TenderFactCandidate = {
  field: string;              // e.g., "clientName", "reference", "deadline"
  candidateType: CandidateType;
  normalizedValue: string;    // Normalized for comparison
  originalValue: string;      // As extracted/displayed
  status: CandidateStatus;
  confidence: number;         // 0-1
  tenderFileId: string | null;
  pageNumber: number | null;
  exactQuote: string | null;
  sourceContentHash: string | null;
  extractionSource: string;   // e.g., "regex:inferClientName", "ai:chunk-1"
  validationResult: "valid" | "invalid" | "placeholder" | "unverified";
  hasCompetingCandidates: boolean;
  createdAt: Date;
  isStale: boolean;
};

/**
 * Determine the candidate status based on evidence quality.
 *
 * - GROUNDED: has fileId + page + quote that's contained in the file's text
 * - CANDIDATE: has a value but no full evidence
 * - NEEDS_REVIEW: multiple valid candidates with different values
 * - REJECTED: invalid value (placeholder, too short, wrong format)
 */
export function determineCandidateStatus(
  candidate: Omit<TenderFactCandidate, "status" | "hasCompetingCandidates" | "isStale">,
  competingCount: number,
): CandidateStatus {
  // Invalid values are always REJECTED
  if (candidate.validationResult === "invalid" || candidate.validationResult === "placeholder") {
    return "REJECTED";
  }

  // Multiple valid candidates with different values → NEEDS_REVIEW
  if (competingCount > 0) {
    return "NEEDS_REVIEW";
  }

  // Has full source evidence → GROUNDED
  if (
    candidate.tenderFileId &&
    candidate.pageNumber !== null &&
    candidate.exactQuote &&
    candidate.exactQuote.trim().length >= 10
  ) {
    return "GROUNDED";
  }

  // Has a value but no full evidence → CANDIDATE
  return "CANDIDATE";
}

/**
 * Check if a candidate can be auto-confirmed.
 *
 * Auto-confirm only when:
 * 1. Status is GROUNDED (has valid source evidence)
 * 2. No competing candidates
 * 3. Validation passed
 * 4. Confidence >= 0.8
 */
export function canAutoConfirm(
  candidate: TenderFactCandidate,
  competingCount: number,
): boolean {
  return (
    candidate.status === "GROUNDED" &&
    competingCount === 0 &&
    candidate.validationResult === "valid" &&
    candidate.confidence >= 0.8 &&
    !candidate.isStale
  );
}

/**
 * Build a stale indicator for a candidate when the scalar value changes.
 *
 * When a field value changes, stale file/page/quote evidence for the old
 * value must be cleared atomically.
 */
export function markStale(
  candidate: TenderFactCandidate,
  newNormalizedValue: string,
): TenderFactCandidate {
  if (candidate.normalizedValue === newNormalizedValue) {
    return candidate; // Not stale — same value
  }
  return {
    ...candidate,
    status: "STALE",
    isStale: true,
  };
}

/**
 * Validate that evidence is usable for grounding.
 *
 * A fact cannot be grounded using:
 * - inactive/deleted TenderFile
 * - page outside source page range
 * - missing quote
 * - ambiguous quote (too short)
 * - quote not contained in original extracted text
 * - outdated source-content hash
 */
export function isEvidenceUsable(
  candidate: Pick<TenderFactCandidate, "tenderFileId" | "pageNumber" | "exactQuote" | "sourceContentHash">,
  activeFileIds: Set<string>,
  fileTotalPages: number | null,
  fileExtractedText: string | null,
  fileContentHash: string | null,
): boolean {
  // File must be active
  if (!candidate.tenderFileId || !activeFileIds.has(candidate.tenderFileId)) {
    return false;
  }

  // Page must be within range
  if (candidate.pageNumber === null || candidate.pageNumber <= 0) {
    return false;
  }
  if (fileTotalPages !== null && fileTotalPages > 0 && candidate.pageNumber > fileTotalPages) {
    return false;
  }

  // Quote must be present and non-trivial
  if (!candidate.exactQuote || candidate.exactQuote.trim().length < 10) {
    return false;
  }

  // Quote must be contained in the file's extracted text (normalized)
  if (fileExtractedText) {
    const normalizedQuote = candidate.exactQuote.toLowerCase().replace(/\s+/g, " ").trim();
    const normalizedText = fileExtractedText.toLowerCase().replace(/\s+/g, " ").trim();
    if (!normalizedText.includes(normalizedQuote)) {
      return false;
    }
  }

  // Source-content hash must match if both are present
  if (candidate.sourceContentHash && fileContentHash && candidate.sourceContentHash !== fileContentHash) {
    return false;
  }

  return true;
}
