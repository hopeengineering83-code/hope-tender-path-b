// Canonical Tender Release State.
//
// ONE server-derived payload for readiness score, blocker totals, bid
// verdict, and next action — consumed by the tender detail page, command
// center, report, and export surfaces so they can never disagree.
//
// This module implements NO new gating logic. It aggregates and reconciles
// the output of the existing fail-closed engines:
//   - getTenderReleaseSnapshot      (extraction/analysis grounding, eligibility)
//   - getCanonicalTenderWorkflowDecision (the ONE next action — do not recompute)
//   - getFinalSubmissionReadiness   (the richest blocker list, category+severity+action)
//   - evaluateBidDecision           (score/verdict — gated, unmodified)
//
// Readiness score and bid verdict are gated behind readinessCalculable:
// valid source extraction (snapshot.extraction.overallOk) AND grounded AI
// analysis (snapshot.analysis.eligibleForExport — AI_SUCCEEDED, not regex
// fallback, content hash current). Before that gate passes, both are null.
// Consumers must render "Not calculated" / "Decision unavailable" — never a
// placeholder number or a default verdict.

import type { PrismaClient } from "@prisma/client";
import { getTenderReleaseSnapshot } from "./tender-release-snapshot";
import { getCanonicalTenderWorkflowDecision } from "./canonical-workflow-decision";
import { getFinalSubmissionReadiness, type FinalSubmissionReadiness } from "./final-submission-readiness";
import { evaluateBidDecision, type BidDecisionOutcome } from "./bid-decision";
import { resolveDeploymentEnvironment } from "../deployment-context.cjs";
import type { CanonicalFieldState } from "./canonical-field-state";

export type TenderReleaseBlockerSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type TenderReleaseBlocker = {
  category: string;
  severity: TenderReleaseBlockerSeverity;
  title: string;
  nextAction: string | null;
};

export type TenderReleaseState = {
  tenderId: string;
  /** Ties to getTenderReleaseSnapshot's revision token — changes whenever any input changes. */
  sourceRevision: string;
  calculatedAt: string;

  extractionGrounded: boolean;
  analysisGrounded: boolean;
  /** extractionGrounded && analysisGrounded — gates readinessScore/verdict below. */
  readinessCalculable: boolean;

  /** null until readinessCalculable — render "Not calculated", never 0 or a stale number. */
  readinessScore: number | null;
  /** null until readinessCalculable — render "Decision unavailable", never a default verdict. */
  verdict: BidDecisionOutcome | null;
  verdictSummary: string | null;

  /** ONE reconciled, deduped blocker list — category-level dedup collapses
   *  the same underlying issue when multiple upstream engines independently
   *  flag it (e.g. EXTRACTION_QUALITY_INSUFFICIENT from both the export gate
   *  and the final-submission readiness checks). */
  blockers: TenderReleaseBlocker[];
  blockerTotal: number;
  criticalBlockerTotal: number;

  /** ONE primary next action — passthrough of the existing canonical workflow
   *  decision. Never recompute a competing next action from raw fields. */
  primaryNextAction: { action: string; label: string; reason: string } | null;

  /** Passthrough of the authoritative, unmodified fail-closed gate flags. */
  generationEligible: boolean;
  exportEligible: boolean;
  finalZipEligible: boolean;

  /** Per-field canonical grounding state (resolveCanonicalFieldState), passed
   *  through from the single getFinalSubmissionReadiness call above — never
   *  refetched or recomputed by a consumer. Used for field-specific display
   *  (e.g. currency provenance), not for blocker/score/verdict/action. */
  canonicalFields: CanonicalFieldState[] | undefined;

  /** True whenever this deployment is not production (preview/CI/dev/local-build). */
  fixtureData: boolean;
  deploymentEnvironment: string;
};

function normalizeSeverity(value: string): TenderReleaseBlockerSeverity {
  const upper = value.toUpperCase();
  if (upper === "CRITICAL") return "CRITICAL";
  if (upper === "HIGH") return "HIGH";
  if (upper === "MEDIUM") return "MEDIUM";
  return "LOW";
}

const SEVERITY_RANK: Record<TenderReleaseBlockerSeverity, number> = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };

// Cross-engine category aliases for the SAME underlying condition, verified
// by runtime inspection to fire together and render as two unrelated red
// warnings for one real issue:
//   - export-readiness.ts's checkFullExportReadiness emits a tenderLevelBlocker
//     CLIENT_NAME_REQUIRED, while final-submission-readiness.ts's own client
//     name gate independently emits CLIENT_NAME_MISSING for the same
//     empty-clientName condition.
//   - export-readiness.ts's checkFullExportReadiness emits a tenderLevelBlocker
//     NO_ACTIVE_GENERATED_DOCUMENTS when docs.length === 0, while its sibling
//     checkExportReadiness independently emits a synthetic __tender__
//     document failure (mapped below to DOCUMENT_NOT_READY:__tender__) for
//     the exact same zero-documents condition.
// Mapped to one dedup key (grouping only — the retained blocker keeps its
// own original category for display) so the same real issue never renders
// as two separate blockers here. The underlying engines are left unchanged
// since export-readiness-panel.tsx and final-submission-control-center.tsx
// still read their full, undeduped output directly.
const CATEGORY_DEDUP_KEY: Record<string, string> = {
  CLIENT_NAME_REQUIRED: "CLIENT_NAME_MISSING",
  "DOCUMENT_NOT_READY:__tender__": "NO_ACTIVE_GENERATED_DOCUMENTS",
};

function dedupKey(category: string): string {
  return CATEGORY_DEDUP_KEY[category] ?? category;
}

/** Exported for direct unit testing of the dedup/reconciliation rules — not
 *  meant to be called by UI consumers, which must use getTenderReleaseState. */
export function reconcileBlockers(finalSubmission: FinalSubmissionReadiness): {
  blockers: TenderReleaseBlocker[];
  blockerTotal: number;
  criticalBlockerTotal: number;
} {
  const raw: TenderReleaseBlocker[] = [
    ...finalSubmission.tenderLevelBlockers.map((b) => ({
      category: b.category,
      severity: normalizeSeverity(b.severity),
      title: b.title,
      nextAction: b.recommendedAction ?? null,
    })),
    ...finalSubmission.documentBlockers.map((b) => ({
      category: `DOCUMENT_NOT_READY:${b.documentId}`,
      severity: normalizeSeverity(b.severity),
      title: `${b.name}: ${b.reasons.join("; ")}`,
      nextAction: b.nextActions[0] ?? null,
    })),
  ];

  // Dedupe by category (via dedupKey, which collapses known cross-engine
  // aliases first) — the same underlying issue is sometimes independently
  // flagged by more than one upstream engine (e.g.
  // export-readiness.ts's checkTenderLevelExportBlockers and
  // final-submission-readiness.ts's own checks both emit
  // EXTRACTION_QUALITY_INSUFFICIENT under the same category code). Keep the
  // highest-severity instance; a lower-severity duplicate adds no information.
  const byCategory = new Map<string, TenderReleaseBlocker>();
  for (const blocker of raw) {
    const key = dedupKey(blocker.category);
    const existing = byCategory.get(key);
    if (!existing || SEVERITY_RANK[blocker.severity] > SEVERITY_RANK[existing.severity]) {
      byCategory.set(key, blocker);
    }
  }
  const blockers = Array.from(byCategory.values()).sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const criticalBlockerTotal = blockers.filter((b) => b.severity === "CRITICAL" || b.severity === "HIGH").length;
  return { blockers, blockerTotal: blockers.length, criticalBlockerTotal };
}

export async function getTenderReleaseState(
  prisma: PrismaClient,
  tenderId: string,
  userId: string,
): Promise<TenderReleaseState | null> {
  const [snapshot, workflowDecision, finalSubmission] = await Promise.all([
    getTenderReleaseSnapshot(prisma, tenderId, userId),
    getCanonicalTenderWorkflowDecision(prisma, userId, tenderId),
    getFinalSubmissionReadiness(prisma, { tenderId, userId }),
  ]);
  if (!snapshot || !finalSubmission) return null;

  const extractionGrounded = snapshot.extraction.overallOk;
  const analysisGrounded = snapshot.analysis.eligibleForExport;
  const readinessCalculable = extractionGrounded && analysisGrounded;

  let readinessScore: number | null = null;
  let verdict: BidDecisionOutcome | null = null;
  let verdictSummary: string | null = null;

  if (readinessCalculable) {
    const bidInputs = await prisma.tender.findFirst({
      where: { id: tenderId, userId },
      select: {
        deadline: true,
        budget: true,
        requirements: { select: { priority: true, requirementType: true, title: true, description: true } },
        complianceGaps: { select: { severity: true, isResolved: true, title: true } },
        expertMatches: { select: { score: true, isSelected: true } },
        projectMatches: { select: { score: true, isSelected: true } },
        generatedDocuments: {
          where: { generationStatus: { not: "SUPERSEDED" } },
          select: { generationStatus: true, reviewStatus: true },
        },
      },
    });
    if (bidInputs) {
      const decision = evaluateBidDecision({
        deadline: bidInputs.deadline,
        budget: bidInputs.budget,
        requirements: bidInputs.requirements.map((r) => ({
          priority: r.priority ?? "",
          requirementType: r.requirementType ?? "",
          title: r.title ?? "",
          description: r.description ?? "",
        })),
        complianceGaps: bidInputs.complianceGaps.map((g) => ({
          severity: g.severity ?? "",
          isResolved: g.isResolved,
          title: g.title ?? "",
        })),
        expertMatches: bidInputs.expertMatches.map((m) => ({ score: m.score ?? 0, isSelected: m.isSelected })),
        projectMatches: bidInputs.projectMatches.map((m) => ({ score: m.score ?? 0, isSelected: m.isSelected })),
        generatedDocuments: bidInputs.generatedDocuments.map((d) => ({
          generationStatus: d.generationStatus ?? "",
          reviewStatus: d.reviewStatus ?? "",
        })),
      });
      readinessScore = decision.score;
      verdict = decision.decision;
      verdictSummary = decision.summary;
    }
  } else {
    verdictSummary =
      "Decision unavailable — valid source extraction and grounded AI analysis are required before a bid verdict can be calculated.";
  }

  const { blockers, blockerTotal, criticalBlockerTotal } = reconcileBlockers(finalSubmission);

  const primaryNextAction = workflowDecision
    ? {
        action: workflowDecision.nextRequiredAction,
        label: workflowDecision.nextRequiredActionLabel,
        reason: workflowDecision.nextRequiredActionReason,
      }
    : null;

  const deploymentEnvironment = resolveDeploymentEnvironment(process.env);

  return {
    tenderId,
    sourceRevision: snapshot.snapshotRevision,
    calculatedAt: snapshot.generatedAt,
    extractionGrounded,
    analysisGrounded,
    readinessCalculable,
    readinessScore,
    verdict,
    verdictSummary,
    blockers,
    blockerTotal,
    criticalBlockerTotal,
    primaryNextAction,
    generationEligible: snapshot.generationEligible,
    exportEligible: snapshot.exportEligible,
    finalZipEligible: snapshot.finalZipEligible,
    canonicalFields: finalSubmission.canonicalFields,
    fixtureData: deploymentEnvironment !== "production",
    deploymentEnvironment,
  };
}
