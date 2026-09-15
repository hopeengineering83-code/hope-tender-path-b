// Canonical Tender Release State.
//
// ONE server-derived payload for readiness score, blocker totals, bid
// verdict, and next action — consumed by the tender detail page, command
// center, report, and export surfaces so they can never disagree.
//
// This module implements NO new gating logic. It aggregates and reconciles
// the output of the existing fail-closed engines.

import type { PrismaClient } from "@prisma/client";
import { getTenderReleaseSnapshot } from "./tender-release-snapshot";
import { getCanonicalTenderWorkflowDecision, type CanonicalWorkflowDecision } from "./canonical-workflow-decision";
import { presentTwoActionWorkflowDecision } from "./two-action-workflow-presentation";
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
  sourceRevision: string;
  calculatedAt: string;
  extractionGrounded: boolean;
  analysisGrounded: boolean;
  readinessCalculable: boolean;
  readinessScore: number | null;
  verdict: BidDecisionOutcome | null;
  verdictSummary: string | null;
  blockers: TenderReleaseBlocker[];
  blockerTotal: number;
  criticalBlockerTotal: number;
  primaryNextAction: { action: string; label: string; reason: string } | null;
  generationEligible: boolean;
  exportEligible: boolean;
  finalZipEligible: boolean;
  canonicalFields: CanonicalFieldState[] | undefined;
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

const CATEGORY_DEDUP_KEY: Record<string, string> = {
  CLIENT_NAME_REQUIRED: "CLIENT_NAME_MISSING",
  "DOCUMENT_NOT_READY:__tender__": "NO_ACTIVE_GENERATED_DOCUMENTS",
};

function dedupKey(category: string): string {
  return CATEGORY_DEDUP_KEY[category] ?? category;
}

export function reconcileBlockers(finalSubmission: FinalSubmissionReadiness): {
  blockers: TenderReleaseBlocker[];
  blockerTotal: number;
  criticalBlockerTotal: number;
} {
  const raw: TenderReleaseBlocker[] = [
    ...finalSubmission.tenderLevelBlockers.map((blocker) => ({
      category: blocker.category,
      severity: normalizeSeverity(blocker.severity),
      title: blocker.title,
      nextAction: blocker.recommendedAction ?? null,
    })),
    ...finalSubmission.documentBlockers.map((blocker) => ({
      category: `DOCUMENT_NOT_READY:${blocker.documentId}`,
      severity: normalizeSeverity(blocker.severity),
      title: `${blocker.name}: ${blocker.reasons.join("; ")}`,
      nextAction: blocker.nextActions[0] ?? null,
    })),
  ];

  const byCategory = new Map<string, TenderReleaseBlocker>();
  for (const blocker of raw) {
    const key = dedupKey(blocker.category);
    const existing = byCategory.get(key);
    if (!existing || SEVERITY_RANK[blocker.severity] > SEVERITY_RANK[existing.severity]) {
      byCategory.set(key, blocker);
    }
  }

  const blockers = Array.from(byCategory.values())
    .sort((left, right) => SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity]);
  const criticalBlockerTotal = blockers
    .filter((blocker) => blocker.severity === "CRITICAL" || blocker.severity === "HIGH")
    .length;
  return { blockers, blockerTotal: blockers.length, criticalBlockerTotal };
}

/**
 * Present only the blocker that is reachable in the canonical workflow.
 *
 * Final-submission readiness deliberately computes every eventual export
 * defect fail-closed. Those diagnostics remain authoritative inside the
 * readiness model, but presenting all of them beside an earlier canonical
 * action (for example UPLOAD_TENDER) invents competing work for the owner.
 */
export function reconcileReachableReleaseBlockers(
  workflowDecision: CanonicalWorkflowDecision | null,
  finalSubmission: FinalSubmissionReadiness,
): { blockers: TenderReleaseBlocker[]; blockerTotal: number; criticalBlockerTotal: number } {
  if (!workflowDecision || workflowDecision.currentBlockingStage === "EXPORT_ZIP_READY") {
    return reconcileBlockers(finalSubmission);
  }

  const category = workflowDecision.blockingStageCode || workflowDecision.currentBlockingStage;
  const title = workflowDecision.blockerDetails[0] || workflowDecision.nextRequiredActionReason;
  const automatic = workflowDecision.nextRequiredAction === "AUTOMATIC_PROCESSING";
  const blocker: TenderReleaseBlocker = {
    category,
    severity: /SECURITY|INTEGRITY|SOURCE|EXTRACTION|ENGINE_RUN_FAILED|TITLE_SOURCE_PROVENANCE_INVALID|AUTHORITY|LEGAL/.test(category)
      ? "CRITICAL"
      : "HIGH",
    title,
    nextAction: automatic ? null : workflowDecision.nextRequiredActionLabel,
  };
  return {
    blockers: [blocker],
    blockerTotal: 1,
    criticalBlockerTotal: 1,
  };
}

export async function getTenderReleaseState(
  prisma: PrismaClient,
  tenderId: string,
  userId: string,
): Promise<TenderReleaseState | null> {
  const [snapshot, rawWorkflowDecision, finalSubmission] = await Promise.all([
    getTenderReleaseSnapshot(prisma, tenderId, userId),
    getCanonicalTenderWorkflowDecision(prisma, userId, tenderId),
    getFinalSubmissionReadiness(prisma, { tenderId, userId }),
  ]);
  if (!snapshot || !finalSubmission) return null;

  const workflowDecision = presentTwoActionWorkflowDecision(rawWorkflowDecision);
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
        requirements: bidInputs.requirements.map((requirement) => ({
          priority: requirement.priority ?? "",
          requirementType: requirement.requirementType ?? "",
          title: requirement.title ?? "",
          description: requirement.description ?? "",
        })),
        complianceGaps: bidInputs.complianceGaps.map((gap) => ({
          severity: gap.severity ?? "",
          isResolved: gap.isResolved,
          title: gap.title ?? "",
        })),
        expertMatches: bidInputs.expertMatches.map((match) => ({
          score: match.score ?? 0,
          isSelected: match.isSelected,
        })),
        projectMatches: bidInputs.projectMatches.map((match) => ({
          score: match.score ?? 0,
          isSelected: match.isSelected,
        })),
        generatedDocuments: bidInputs.generatedDocuments.map((document) => ({
          generationStatus: document.generationStatus ?? "",
          reviewStatus: document.reviewStatus ?? "",
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

  const { blockers, blockerTotal, criticalBlockerTotal } = reconcileReachableReleaseBlockers(
    workflowDecision,
    finalSubmission,
  );

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
