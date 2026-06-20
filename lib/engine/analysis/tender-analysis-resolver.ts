// Thin adapter that delegates to the canonical analysis-state-resolver.
//
// This file was previously a SEPARATE resolver with drift states
// (SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED, PARTIAL_AI_NEEDS_REVIEW),
// chunk querying without contentHash filtering, and hardcoded totalChunks
// from chunks[0].totalChunks. It has been unified into the canonical
// resolver at lib/engine/analysis-state-resolver.ts.
//
// The canonical resolver is the SINGLE source of truth for AI analysis
// state. This adapter exists for backward compatibility with callers that
// pass (prisma, tenderId) instead of (tenderId, userId). It looks up the
// tender's owner to satisfy the canonical resolver's tenant-isolation
// requirement.
//
// IMPORTANT: New callers should call the canonical resolver directly:
//   import { resolveTenderAnalysisState } from "../analysis-state-resolver";
//   const detail = await resolveTenderAnalysisState(tenderId, userId);

import { PrismaClient } from "@prisma/client";
import {
  resolveTenderAnalysisState as resolveCanonical,
  type TenderAnalysisStateDetail,
} from "../analysis-state-resolver";

// Re-export the canonical detail type so existing consumers don't break.
export type { TenderAnalysisStateDetail };

// Re-export the canonical state type under the legacy name for backward compat.
// The canonical resolver uses AnalysisState; the legacy code used
// TenderAnalysisState. They are now the same type.
export type TenderAnalysisState = TenderAnalysisStateDetail["state"];

// Legacy result shape — mapped from the canonical detail. This preserves
// the public API response shape used by the current UI (workflow-center
// route, reconcile-state route) while internally consuming the canonical
// result.
export type AnalysisResolverResult = {
  state: TenderAnalysisState;
  latestJobId: string | null;
  canonicalJobId: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  analysisSource: "AI" | "REGEX_FALLBACK" | "LEGACY_NOTES" | "NONE";
  successfulProvider: string | null;
  attemptedProviders: string[];
  providerFailureCategories: Record<string, string>;
  requirementsExtracted: number;
  requirementsPersisted: number;
  sourceReferencesCreated: number;
  metadataFieldsPersisted: number;
  completedChunks: number;
  totalChunks: number;
  resumable: boolean;
  resumableJobId: string | null;
  nextAction: string | null;
  safeDiagnosticSummary: string;
};

/**
 * Legacy adapter: resolves the canonical analysis state and maps it to the
 * old result shape. Accepts (prisma, tenderId) for backward compat.
 *
 * Internally looks up the tender's owner (userId) so the canonical resolver's
 * tenant-isolation scoping is preserved. If the tender doesn't exist or
 * doesn't belong to any user, throws "Tender not found" (same as before).
 */
export async function resolveTenderAnalysisState(
  prisma: PrismaClient,
  tenderId: string
): Promise<AnalysisResolverResult> {
  // Look up the tender's owner for tenant isolation. The canonical resolver
  // scopes ALL queries by userId — this lookup ensures the adapter doesn't
  // weaken that isolation.
  const tender = await prisma.tender.findUnique({
    where: { id: tenderId },
    select: { userId: true },
  });

  if (!tender) {
    throw new Error("Tender not found");
  }

  // Delegate to the canonical resolver.
  const detail = await resolveCanonical(tenderId, tender.userId);

  // Map the canonical detail to the legacy result shape.
  return {
    state: detail.state,
    latestJobId: detail.latestJobId,
    canonicalJobId: detail.canonicalJobId,
    startedAt: detail.startedAt,
    finishedAt: detail.finishedAt,
    analysisSource: detail.analysisSource,
    successfulProvider: detail.successfulProvider,
    attemptedProviders: detail.providerAttempts.map((p) => p.provider),
    providerFailureCategories: Object.fromEntries(
      detail.providerAttempts
        .filter((p) => p.status === "FAILED")
        .map((p) => [p.provider, p.failures > 0 ? "FAILED" : "UNKNOWN"])
    ),
    requirementsExtracted: detail.requirementsExtracted,
    requirementsPersisted: detail.requirementsExtracted,
    sourceReferencesCreated: detail.sourceReferencesCreated ? 1 : 0,
    metadataFieldsPersisted: detail.metadataFieldsPersisted ? 1 : 0,
    completedChunks: detail.completedChunks,
    totalChunks: detail.totalChunks,
    resumable: detail.resumable,
    resumableJobId: detail.resumable ? detail.latestJobId : null,
    nextAction: detail.nextAction,
    safeDiagnosticSummary: detail.safeDiagnosticSummary,
  };
}

// NOTE: The legacy checkRequirementConsistency helper was removed during
// unification. It was not called by any consumer and its return value
// was a drift state not in the canonical 9-state enum. The canonical
// resolver's AI_SUCCEEDED state with requirementsExtracted=0 conveys the
// same information without a separate state.
