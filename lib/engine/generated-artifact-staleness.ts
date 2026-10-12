// When may an already-GENERATED artifact be regenerated?
//
// THE DEFECT THIS REPLACES
// ------------------------
// `missing-plan-file-generation.ts` filled files the confirmed plan was
// missing, and skipped any row that already existed with a status other than
// PLANNED:
//
//   if (existing && existing.generationStatus !== "PLANNED") {
//     skipped.push(document.fileName);
//
// That is correct for a good document and wrong for a bad one. A
// "Technical Approach and Methodology.docx" written by an early generator as a
// 367-word stub was stored as GENERATED, so every later run skipped it by
// name — including the run whose whole purpose was a repaired methodology
// generator. The artifact stayed 367 words, kept failing the quality gate, and
// kept blocking the package ZIP. Improving a generator therefore had no effect
// on any tender that had already been through the pipeline once, which is
// every tender an owner has ever run.
//
// THE CONTRACT
// ------------
// Generators declare a content-contract version. An artifact records the
// version it was produced under. When the recorded version is older than the
// current one, the artifact was written to a contract the app no longer
// considers correct and may be regenerated once. After regeneration the
// recorded version equals the current one, so the next run skips it.
//
// Version equality is the fixpoint, which is what makes this safe: there is no
// counter to exhaust and no quality score to oscillate around, so regeneration
// cannot loop. A good, current artifact is never touched.
//
// WHAT IS NEVER OVERWRITTEN
// -------------------------
// Anything carrying owner intent. A row awaiting the client's own file
// (REPLACE_WITH_ORIGINAL) or already superseded is left exactly as it is: the
// owner's decision outranks any generator improvement, and silently replacing
// an official original would be a provenance failure, not a repair.

/**
 * Bump when a generator's OUTPUT CONTRACT changes in a way that makes
 * previously generated artifacts wrong rather than merely different — a new
 * required section, a corrected structure, a fixed stub.
 *
 * Do NOT bump for cosmetic or formatting-only changes: every bump makes every
 * pre-existing artifact eligible for one regeneration pass.
 *
 * v2 — 2026-09-21. v1 artifacts include methodology narratives written by the
 * pre-repair generator as a requirement list plus optional evidence (measured
 * at 367 words against an 800-word floor, missing phases, tasks, deliverables,
 * schedule, QA and risk).
 */
export const GENERATOR_CONTENT_CONTRACT_VERSION = 2;

const CONTRACT_MARKER = /\[generator-contract:v(\d+)\]/i;

/** The marker appended to an artifact's contentSummary to record its contract. */
export function contractMarker(version: number = GENERATOR_CONTENT_CONTRACT_VERSION): string {
  return `[generator-contract:v${version}]`;
}

/** The contract version an artifact records, or null when it predates the contract. */
export function recordedContractVersion(contentSummary: string | null | undefined): number | null {
  if (!contentSummary) return null;
  const match = CONTRACT_MARKER.exec(contentSummary);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Record (or update) the contract marker on a contentSummary, idempotently. */
export function withContractMarker(
  contentSummary: string | null | undefined,
  version: number = GENERATOR_CONTENT_CONTRACT_VERSION,
): string {
  const base = (contentSummary ?? "").replace(CONTRACT_MARKER, "").replace(/\s+$/, "");
  const marker = contractMarker(version);
  return base ? `${base} ${marker}` : marker;
}

export type RegenerationDecision = {
  regenerate: boolean;
  /** Always populated: a skip is as much a decision as a rewrite. */
  reason: string;
};

/**
 * Review states that carry owner intent and must never be overwritten by an
 * automatic regeneration.
 */
const OWNER_INTENT_REVIEW_STATES = new Set(["REPLACE_WITH_ORIGINAL", "SUPERSEDED"]);

export function decideExistingArtifactRegeneration(input: {
  generationStatus: string | null | undefined;
  reviewStatus?: string | null;
  contentSummary?: string | null;
  /**
   * Set by the caller when the artifact is known to fail the CURRENT quality
   * rules. Optional: the contract version alone already catches artifacts
   * written to a superseded contract, and callers without a quality verdict to
   * hand must not have to compute one inside a write transaction.
   */
  failsCurrentQuality?: boolean;
  currentContractVersion?: number;
}): RegenerationDecision {
  const current = input.currentContractVersion ?? GENERATOR_CONTENT_CONTRACT_VERSION;
  const status = (input.generationStatus ?? "").trim();
  const review = (input.reviewStatus ?? "").trim();

  // PLANNED rows are the ordinary fill-in path, not a regeneration.
  if (status === "PLANNED") {
    return { regenerate: false, reason: "PLANNED row: ordinary generation, not a regeneration." };
  }
  if (status === "SUPERSEDED") {
    return { regenerate: false, reason: "Already superseded; a newer row is the live artifact." };
  }
  if (OWNER_INTENT_REVIEW_STATES.has(review)) {
    return {
      regenerate: false,
      reason: `reviewStatus=${review} carries owner intent; an automatic regeneration must not overwrite it.`,
    };
  }

  const recorded = recordedContractVersion(input.contentSummary);
  if (recorded === null) {
    return {
      regenerate: true,
      reason: `Artifact records no generator contract, so it predates v${current} and was written to a contract the app no longer considers correct.`,
    };
  }
  if (recorded < current) {
    return {
      regenerate: true,
      reason: `Artifact was produced under generator contract v${recorded}; the current contract is v${current}.`,
    };
  }
  if (input.failsCurrentQuality) {
    return {
      regenerate: true,
      reason: `Artifact is at the current contract v${recorded} but fails the current quality rules.`,
    };
  }
  return {
    regenerate: false,
    reason: `Artifact is current (contract v${recorded}) and not failing quality; regenerating it would be needless churn.`,
  };
}
