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
// Authority chain — what this module ACTUALLY reaches today.
//
// getCanonicalReleaseDecision calls exactly one thing,
// getCanonicalTenderReadiness, whose own imports are:
//
//   CanonicalReleaseDecision
//     └─ getCanonicalTenderReadiness
//          ├─ getTenderGenerationReadinessStrict
//          ├─ assessMatchingQuality
//          ├─ getCompanyIngestionReadiness
//          ├─ findMissingGeneratedDocuments
//          ├─ filterFinalExportCandidateDocuments
//          ├─ getCurrentConfirmedBuildPlan
//          ├─ computeTenderReadinessState
//          ├─ computeCanonicalModuleStates
//          ├─ detectAnalysisSourceWithApproval
//          ├─ canUseVaultRecord
//          └─ getFinalSubmissionReadiness  (strict export gate; see below)
//
// THE STRICT EXPORT GATE IS NOW IN THE CHAIN — but only for the question it
// alone can answer. An earlier version of this comment recorded that
// checkFullExportReadiness, getFinalSubmissionReadiness and
// getFinalPackageReadinessModel were NOT reached from here, so
// `readyToDownload` reflected neither byte integrity, envelope separation,
// pricing leakage, placeholder/AI-trace scanning, manifest consistency nor the
// originals the owner compiles outside the App. That gap was not merely
// prospective: the Release Status panel derived "Ready to download — The final
// ZIP package is ready" from it on a tender whose /export refused the ZIP with
// PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED (Pharo, Preview 2026-10-11).
//
// getCanonicalTenderReadiness now asks getFinalSubmissionReadiness — which runs
// checkFullExportReadiness — whenever its own checks find the package done
// (or only tender forms awaiting originals left), and folds the verdict in:
//
//   SUBMISSION_READY                             → readyForFinalExport may be true
//   PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED → OWNER_ATTACHMENTS_REQUIRED,
//                                                  status PROPOSAL_COMPLETE_…
//   anything else, or the gate unreadable        → FINAL_SUBMISSION_GATE_BLOCKED
//
// So READY_TO_DOWNLOAD now requires the strict gate's SUBMISSION_READY. What is
// still NOT reached from here: the readiness call reads byte metadata
// (requireFileContent=false), not the bytes themselves, and
// getFinalPackageReadinessModel's manifest is not consulted. The archive owner
// (/api/tenders/[id]/download?type=zip) therefore still runs its own gate with
// requireFileContent=true and never reads this decision — keep it that way.
//
// Real consumers today:
//   - app/api/tenders/[id]/readiness/route.ts  (reports the decision)
//   - components/generation-action-panel.tsx   (renders the status text)

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
  /** True iff the final ZIP is ready to download (strict gate: SUBMISSION_READY). */
  readyToDownload: boolean;
  /**
   * True iff every App-generated document is complete — in SUBMISSION_READY
   * and in PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED. The proposal package
   * (download?type=zip&scope=proposal) is offered on this, never the final ZIP.
   */
  proposalComplete: boolean;
  /** The strict final-submission gate's package verdict. */
  packageStatus: CanonicalTenderReadiness["packageStatus"];
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
    proposalComplete: status === "READY_TO_DOWNLOAD" || status === "PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED",
    packageStatus: readiness.packageStatus,
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

  // runtime-readiness-facts was listed here as DELETE. It is not deletable:
  // app/api/tenders/[id]/runtime-readiness-parity/route.ts imports
  // getRuntimeReadinessFacts and safePanelError from it, so acting on that
  // classification would 500 a live route. It is diagnostic rather than
  // authoritative — which is what DELEGATE means here — so it is recorded as
  // DELEGATE, and the test below now refuses any DELETE entry that still has
  // a production importer.
  "lib/engine/runtime-readiness-facts.ts": "DELEGATE" as const,
} as const;

export type ReadinessCalculatorClassification = typeof READINESS_CALCULATOR_CLASSIFICATION;
