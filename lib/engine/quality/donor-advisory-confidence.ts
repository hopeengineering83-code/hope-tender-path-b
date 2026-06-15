// Donor-advisory confidence model.
//
// Production screenshots showed ESMP / Logframe / M&E plan advisories
// appearing as blockers on tenders whose ToR neither required them nor even
// mentioned them. The export-readiness engine already split "explicitly
// required in tender" from "donor context only" (lib/engine/export-readiness.ts
// `checkTenderLevelExportBlockers`), but the resulting advisory objects did
// not carry a typed confidence the UI / audit layer could read.
//
// This module formalises the confidence enum and the export-blocking rule:
//
//   • EXPLICIT_TOR_REQUIRED      — found in tender source as a stated
//                                  ToR requirement (mandatory / shall / must).
//                                  ONLY THIS LEVEL CAN BLOCK EXPORT.
//   • DONOR_CONTEXT_RECOMMENDED  — donor/NGO tender, doc-type commonly
//                                  expected by donors of this kind, but not
//                                  explicitly required by THIS ToR.
//   • NOT_FOUND_IN_TOR           — non-donor tender, advisory does not apply.
//                                  Future-use; not generated today.
//   • USER_MARKED_NOT_REQUIRED   — user resolution: "not required by ToR".
//   • POST_AWARD_DELIVERABLE     — user resolution: "post-award deliverable".
//   • DONOR_TEMPLATE_PROVIDED    — user resolution: "donor template provided".
//   • ADDED_TO_TECHNICAL         — user resolution: "already added under
//                                  technical proposal".
//
// Hard invariant — enforced by `isExportBlockingConfidence`: the only
// confidence value that can promote an advisory to an export blocker is
// EXPLICIT_TOR_REQUIRED. Every other state stays advisory-only.

export type DonorAdvisoryConfidence =
  | "EXPLICIT_TOR_REQUIRED"
  | "DONOR_CONTEXT_RECOMMENDED"
  | "NOT_FOUND_IN_TOR"
  | "USER_MARKED_NOT_REQUIRED"
  | "POST_AWARD_DELIVERABLE"
  | "DONOR_TEMPLATE_PROVIDED"
  | "ADDED_TO_TECHNICAL";

/** Single hard invariant — keeps the export gate honest. */
export function isExportBlockingConfidence(confidence: DonorAdvisoryConfidence | undefined | null): boolean {
  return confidence === "EXPLICIT_TOR_REQUIRED";
}

/** Map the existing AdvisoryResolutionKind values to the new confidence enum
 *  so user resolutions surface consistently across the UI and audit log. */
export function confidenceFromResolutionKind(kind: string | null | undefined): DonorAdvisoryConfidence | null {
  switch ((kind ?? "").trim().toUpperCase().split("|")[0].trim()) {
    case "NOT_REQUIRED_BY_TOR": return "USER_MARKED_NOT_REQUIRED";
    case "POST_AWARD_DELIVERABLE": return "POST_AWARD_DELIVERABLE";
    case "DONOR_TEMPLATE_PROVIDED": return "DONOR_TEMPLATE_PROVIDED";
    case "ADDED_TO_TECHNICAL": return "ADDED_TO_TECHNICAL";
    default: return null;
  }
}

/** Result of scanning tender source for an explicit ToR requirement of a
 *  donor-safeguard doc. When `explicit` is true, `sourceQuote` carries the
 *  verbatim context (≤200 chars) so the audit log and the readiness panel
 *  can show "found in tender ToR: …" instead of "system inferred". */
export type ExplicitRequirementScanResult = {
  explicit: boolean;
  sourceQuote: string | null;
  /** Confidence to attach to the advisory object. Derived from `explicit`. */
  confidence: DonorAdvisoryConfidence;
};

const EXPLICIT_TOR_PATTERNS: RegExp[] = [
  // "must|shall|mandatory|required|deliverable" within 80 chars of the keyword
  /(?:tor|terms?\s+of\s+reference|mandatory|required|must|shall).{0,80}(?:esmp|logframe|results?\s+framework|m&e|monitoring.*evaluation|environmental|social.*safeguard)/i,
  /deliverable.{0,40}(?:esmp|logframe|m&e|results?\s+framework)/i,
];

/**
 * Scans the supplied tender source text for an explicit ToR requirement of
 * one of the donor-safeguard documents (ESMP / Logframe / M&E plan).
 *
 * Returns the verbatim quote (≤200 chars) when matched, so callers can
 * persist it on the advisory object and the audit log.
 */
export function scanTenderForExplicitDonorRequirement(sourceText: string): ExplicitRequirementScanResult {
  const text = (sourceText ?? "").toString();
  if (text.length === 0) return { explicit: false, sourceQuote: null, confidence: "DONOR_CONTEXT_RECOMMENDED" };
  for (const rx of EXPLICIT_TOR_PATTERNS) {
    const m = rx.exec(text);
    if (m) {
      // Capture ±80 chars of context around the match so a reviewer can
      // verify the classification without opening the tender file.
      const start = Math.max(0, m.index - 40);
      const end = Math.min(text.length, m.index + m[0].length + 80);
      const quote = text.slice(start, end).replace(/\s+/g, " ").trim().slice(0, 200);
      return { explicit: true, sourceQuote: quote, confidence: "EXPLICIT_TOR_REQUIRED" };
    }
  }
  return { explicit: false, sourceQuote: null, confidence: "DONOR_CONTEXT_RECOMMENDED" };
}
