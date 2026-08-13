import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getTenderGenerationReadinessStrict } from "../../../../../lib/tender-generation-readiness-strict";
import { detectAnalysisSourceWithApproval } from "../../../../../lib/engine/analysis-source";
import { getFinalPackageReadinessModel } from "../../../../../lib/engine/final-package-readiness-model";
import { randomUUID } from "node:crypto";
import { buildPublicReadinessEnvelope } from "../../../../../lib/engine/public-readiness-envelope";
import { getCanonicalTenderWorkflowDecision } from "../../../../../lib/engine/canonical-workflow-decision";
import { presentTwoActionWorkflowDecision } from "../../../../../lib/engine/two-action-workflow-presentation";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: tenderId } = await params;

  try {
    await prismaReady;
    const [readiness, tender, rawWorkflowDecision] = await Promise.all([
      getTenderGenerationReadinessStrict(prisma, userId, tenderId),
      prisma.tender.findFirst({
        where: { id: tenderId, userId },
        select: { notes: true },
      }),
      getCanonicalTenderWorkflowDecision(prisma, userId, tenderId),
    ]);
    if (!readiness || !tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

    // Only called once the tender is confirmed to exist — this function
    // throws for a nonexistent tender, which previously reached the
    // Promise.all above and rejected the whole request into the generic
    // 500 handler before the not-found check ever ran.
    const finalPackage = await getFinalPackageReadinessModel(prisma, tenderId, userId);

    const submissionPlanBuilt = finalPackage.buildPlan.confirmed;
    const requiredDocumentsTotal = finalPackage.documents.required.length;
    const generatedDocumentsTotal = finalPackage.documents.generated.length;
    const exportReadyDocumentsTotal = finalPackage.documents.exportReady.length;

    // Use the canonical helper which checks both tender.notes AND the
    // ANALYSIS_APPROVAL:REGEX_FALLBACK ComplianceGap so a human-approved
    // fallback is not treated the same as an unapproved one.
    const analysisSource = await detectAnalysisSourceWithApproval(prisma, tenderId, tender);
    const isUnapprovedFallback = analysisSource === "REGEX_FALLBACK_AI_ERROR" || analysisSource === "UNKNOWN";
    const isApprovedFallback = analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK";

    const submissionPlanBlocker = !submissionPlanBuilt && !isUnapprovedFallback
      ? [{
          code: "NO_CONFIRMED_BUILD_PLAN",
          message: finalPackage.buildPlan.blockerReason
            ?? "Full proposal generation is blocked because Run Engine has not created and source-verified the current Build Plan.",
          nextAction: "RUN_ENGINE",
        }]
      : [];

    const packageBlockers = [
      ...finalPackage.requirements.blockers,
      ...finalPackage.documents.blockers,
      ...finalPackage.export.blockers,
    ].map((blocker) => ({
      code: blocker.code,
      message: blocker.reason,
      nextAction: blocker.nextAction,
    }));

    const independentlyDerivedBlockers = isUnapprovedFallback
      ? [{
          code: analysisSource === "UNKNOWN" ? "FULL_PROPOSAL_NOT_ANALYZED" : "FULL_PROPOSAL_REGEX_FALLBACK_ANALYSIS",
          message: analysisSource === "UNKNOWN"
            ? "Full proposal generation is blocked because this tender has not been analyzed. Run AI Analyze first."
            : "Full proposal generation is blocked because the latest analysis used regex fallback and has not been human-approved. Re-run AI Analyze with healthy providers, or approve the fallback analysis via the tender dashboard.",
          nextAction: "RETRY_AI_ANALYZE",
        }, ...readiness.fullProposalBlockers]
      : [...submissionPlanBlocker, ...packageBlockers, ...readiness.fullProposalBlockers];

    // Readiness is a projection of canonical workflow truth, never an
    // independent workflow authority. In particular, legacy notes can report
    // UNKNOWN after a current AI_ANALYZE/ENGINE_RUN has succeeded. That stale
    // signal previously produced the impossible Preview combination
    // "Run AI Analyze" here while workflow-center truthfully reported the
    // current evidence blocker. Suppress every secondary/downstream diagnosis
    // while a canonical stage is blocking or processing.
    const workflowDecision = presentTwoActionWorkflowDecision(rawWorkflowDecision);
    const canonicalBlocksGeneration = Boolean(
      workflowDecision && workflowDecision.currentBlockingStage !== "EXPORT_ZIP_READY",
    );
    const fullProposalBlockers = canonicalBlocksGeneration && workflowDecision
      ? [{
          code: workflowDecision.blockingStageCode,
          message: workflowDecision.nextRequiredActionReason,
          nextAction: workflowDecision.nextRequiredAction,
        }]
      : independentlyDerivedBlockers;

    const canonicalAnalysisComplete = workflowDecision?.stageStates.RUN_AI_ANALYZE === "COMPLETE";
    const warnings = (isUnapprovedFallback || isApprovedFallback) && !canonicalAnalysisComplete
      ? [{
          code: isApprovedFallback ? "ANALYSIS_USED_APPROVED_REGEX_FALLBACK" : analysisSource === "UNKNOWN" ? "ANALYSIS_NOT_RUN" : "ANALYSIS_USED_REGEX_FALLBACK",
          message: isApprovedFallback
            ? "Latest analysis used regex fallback (human-approved). Verify forms, scoring, and submission rules carefully before final export."
            : analysisSource === "UNKNOWN"
              ? "Tender has not been analyzed. Run AI Analyze to extract requirements and scoring criteria."
              : "Latest analysis used regex fallback. Review forms, scoring, file names, submission rules, and expert/project requirements before relying on the result.",
          nextAction: isApprovedFallback ? "REVIEW_ANALYSIS" : "RETRY_AI_ANALYZE",
        }, ...readiness.warnings]
      : readiness.warnings;

    const readyForSupportPackage = Boolean(readiness.supportPackageReady);
    const readyForFullProposal = Boolean(readiness.fullProposalReady)
      && !canonicalBlocksGeneration
      && !isUnapprovedFallback
      && submissionPlanBuilt
      && packageBlockers.length === 0;

    const analysisSourceGate = isUnapprovedFallback
      ? analysisSource === "UNKNOWN" ? "NOT_ANALYZED" : "BLOCKED_REGEX_FALLBACK"
      : isApprovedFallback
        ? "ALLOWED_APPROVED_FALLBACK"
        : "OK";

    const publicBlockers = [...readiness.blockers, ...fullProposalBlockers];
    const envelope = buildPublicReadinessEnvelope({
      ok: readyForFullProposal,
      blockers: publicBlockers,
      warnings,
      requiredDocumentsTotal,
      generatedDocumentsTotal,
      exportReadyDocumentsTotal,
    });

    return NextResponse.json({
      ...readiness,
      ...envelope,
      fullProposalBlockers,
      supportPackageReady: readyForSupportPackage,
      fullProposalReady: readyForFullProposal,
      ready: readyForFullProposal,
      readyForSupportPackage,
      readyForFullProposal,
      readyForAnySafeGeneration: readyForSupportPackage || readyForFullProposal,
      analysisSourceGate,
      analysisSource,
      currentBlockingStage: workflowDecision?.currentBlockingStage ?? null,
      canonicalDecision: workflowDecision,
      submissionPlanBuilt,
      buildPlan: finalPackage.buildPlan,
      finalPackageCounts: {
        requiredDocumentsTotal,
        generatedDocumentsTotal,
        exportReadyDocumentsTotal,
      },
      finalExportReady: false,
      finalExportReadyEvaluated: false,
      links: {
        tenderDashboard: `/dashboard/tenders/${tenderId}`,
        exportReadiness: `/api/tenders/${tenderId}/export-readiness`,
        exportReadinessPanel: `/dashboard/tenders/${tenderId}#export-readiness`,
      },
      gateSemantics: {
        ready: "full proposal readiness only",
        supportPackageReady: "support/admin package readiness only; not final proposal/export readiness",
        fullProposalReady: "main proposal generation readiness; requires trusted analysis and a current source-verified Build Plan created by Run Engine",
        finalExportReady: "not evaluated by generation-readiness; check links.exportReadiness or the dashboard export-readiness panel",
      },
    });
  } catch (error) {
    const diagnosticId = randomUUID();
    logger.error("[generation-readiness]", {
      route: "/api/tenders/[id]/generation-readiness",
      tenderId,
      diagnosticId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      message: error instanceof Error ? error.message : "Non-Error throwable",
    });
    return NextResponse.json({
      error: "Generation readiness panel failed to load.",
      panel: "generation-readiness",
      endpoint: "/api/tenders/[id]/generation-readiness",
      diagnosticId,
      code: "GENERATION_READINESS_RUNTIME_ERROR",
      retryable: true,
      staleDataPossible: false,
    }, { status: 500 });
  }
}
