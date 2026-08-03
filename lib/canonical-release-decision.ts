// Gap 5: CanonicalReleaseDecision — the ONE readiness authority.
//
// Every worker, route, UI panel, and ZIP gate must consume the same
// decision. This module wraps the existing getCanonicalTenderReadiness
// output and classifies every other readiness calculator as CANONICAL,
// DELEGATE, or DELETE.
//
// Classification:
//   CANONICAL — this module. The single source of truth.
//   DELEGATE  — consumed by CANONICAL to compute sub-results. May not be
//               consumed directly by UI/routes/workers. Must route through
//               CanonicalReleaseDecision.
//   DELETE    — overlapping policy that duplicates CANONICAL. Scheduled for
//               removal after parity tests pass.
//
// Authority chain:
//   CanonicalReleaseDecision
//     ├─ getCanonicalTenderReadiness (DELEGATE — the computation engine)
//     ├─ getTenderGenerationReadinessStrict (DELEGATE — sub-input)
//     ├─ assessMatchingQuality (DELEGATE — sub-input)
//     ├─ getCurrentConfirmedBuildPlan (DELEGATE — sub-input)
//     ├─ findMissingGeneratedDocuments (DELEGATE — sub-input)
//     ├─ checkFullExportReadiness (DELEGATE — byte/hygiene gate for ZIP)
//     ├─ assertTenderReadyForGenerationAndExport (DELEGATE — generation gate)
//     ├─ getFinalSubmissionReadiness (DELEGATE — export gate, delegates to
//     │   checkFullExportReadiness internally)
//     ├─ getFinalPackageReadinessModel (DELEGATE — package model, delegates
//     │   to generation-readiness + export-readiness internally)
//     ├─ computeTenderLifecycle (DELEGATE — lifecycle state, delegates to
//     │   getCurrentConfirmedBuildPlan + assessExtractionQuality)
//     ├─ readiness-scoring (DELEGATE — numeric score, consumed by
//     │   final-submission-readiness)
//     ├─ runtime-readiness-facts (DELETE — diagnostic only, not authoritative)
//     └─ public-readiness-envelope (DELEGATE — redaction wrapper around
//         lifecycle/export-readiness/readiness-score)
//
// Consumers that MUST route through CanonicalReleaseDecision:
//   - UI: generation-action-panel.tsx (deriveReleaseStatus)
//   - Routes: every mutation route's canonicalReadiness response field
//   - Workers: auto-finalize-continuation-service convergence check
//   - ZIP gate: /api/tenders/[id]/download?type=zip

import type { PrismaClient } from "@prisma/client";
import { getCanonicalTenderReadiness, type CanonicalTenderReadiness } from "./canonical-tender-readiness";
import { classifyReleaseStatus, type ReleaseStatus } from "./release-status-classifier";

/**
 * The single release decision consumed by every worker, route, UI panel,
 * and ZIP gate. Wraps CanonicalTenderReadiness with the five-status
 * classification the UI renders.
 */
export type CanonicalReleaseDecision = {
  /** The underlying canonical readiness computation. */
  readiness: CanonicalTenderReadiness | null;
  /** The five-status classification. UI renders this as plain text. */
  status: ReleaseStatus;
  /** True iff the final ZIP is ready to download. */
  readyToDownload: boolean;
  /** True iff the workflow is processing automatically (no blocker). */
  processing: boolean;
  /** True iff a genuine source blocker exists (user must upload). */
  sourceBlocked: boolean;
  /** True iff a legal signature/declaration/ADMIN release is required. */
  legalReleaseRequired: boolean;
  /** True iff a security or integrity failure occurred. */
  securityFailure: boolean;
  /** The blocker codes that drove the status classification. */
  blockerCodes: string[];
};

export type { ReleaseStatus } from "./release-status-classifier";

/**
 * Compute the single CanonicalReleaseDecision for a tender.
 *
 * This is the ONE function every consumer should call. It wraps
 * getCanonicalTenderReadiness and classifies the result into one of five
 * statuses. No other readiness calculator should be consumed directly by
 * UI, routes, or workers — they must route through this function.
 */
export async function getCanonicalReleaseDecision(
  client: PrismaClient,
  userId: string,
  tenderId: string,
): Promise<CanonicalReleaseDecision | null> {
  const readiness = await getCanonicalTenderReadiness(client, userId, tenderId);
  if (!readiness) return null;

  const blockerCodes = readiness.blockers;
  const status = classifyReleaseStatus(blockerCodes, readiness.readyForFinalExport);

  return {
    readiness,
    status,
    readyToDownload: status === "READY_TO_DOWNLOAD",
    processing: status === "PROCESSING_AUTOMATICALLY",
    sourceBlocked: status === "GENUINE_SOURCE_BLOCKED",
    legalReleaseRequired: status === "LEGAL_RELEASE_REQUIRED",
    securityFailure: status === "FAILED_SECURITY_OR_INTEGRITY",
    blockerCodes,
  };
}

/**
 * Classification of every existing readiness calculator in the codebase.
 * Used by the parity test to verify no calculator is consumed directly
 * by UI/routes/workers without routing through CanonicalReleaseDecision.
 */
export const READINESS_CALCULATOR_CLASSIFICATION = {
  // CANONICAL — the single source of truth.
  "lib/canonical-release-decision.ts": "CANONICAL" as const,
  "lib/canonical-tender-readiness.ts": "DELEGATE" as const, // computation engine

  // DELEGATE — consumed by CANONICAL to compute sub-results.
  "lib/tender-generation-readiness.ts": "DELEGATE" as const,
  "lib/tender-generation-readiness-strict.ts": "DELEGATE" as const,
  "lib/engine/tender-lifecycle-orchestrator.ts": "DELEGATE" as const,
  "lib/engine/final-submission-readiness.ts": "DELEGATE" as const,
  "lib/engine/final-package-readiness-model.ts": "DELEGATE" as const,
  "lib/engine/export-readiness.ts": "DELEGATE" as const,
  "lib/engine/generation-readiness-gate.ts": "DELEGATE" as const,
  "lib/engine/readiness-scoring.ts": "DELEGATE" as const,
  "lib/engine/canonical-readiness-state.ts": "DELEGATE" as const,
  "lib/engine/public-readiness-envelope.ts": "DELEGATE" as const,

  // DELETE — diagnostic only, not authoritative.
  "lib/engine/runtime-readiness-facts.ts": "DELETE" as const,
} as const;

export type ReadinessCalculatorClassification = typeof READINESS_CALCULATOR_CLASSIFICATION;
