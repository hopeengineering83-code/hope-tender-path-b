import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getTenderGenerationReadinessStrict } from "../../../../../lib/tender-generation-readiness-strict";
import { detectAnalysisSourceWithApproval } from "../../../../../lib/engine/analysis-source";
import { safeParseJsonArray } from "../../../../../lib/safe-json";
import { randomUUID } from "node:crypto";

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
    const [readiness, tender] = await Promise.all([
      getTenderGenerationReadinessStrict(prisma, userId, tenderId),
      prisma.tender.findFirst({
        where: { id: tenderId, userId },
        select: { notes: true, exactFileNaming: true, exactFileOrder: true, _count: { select: { requirements: true } } },
      }),
    ]);
    if (!readiness || !tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

    // Canonical submission-plan check: block full proposal when requirements
    // exist but no submission plan has been built (exactFileNaming is empty/null
    // and no per-requirement exactFileName entries exist).
    const planEntries = safeParseJsonArray(tender.exactFileNaming);
    const orderEntries = safeParseJsonArray(tender.exactFileOrder);
    const submissionPlanBuilt = (Array.isArray(planEntries) && planEntries.length > 0) || (Array.isArray(orderEntries) && orderEntries.length > 0);
    const requirementsExist = (tender._count.requirements ?? 0) > 0;

    // Use the canonical helper which checks both tender.notes AND the
    // ANALYSIS_APPROVAL:REGEX_FALLBACK ComplianceGap so a human-approved
    // fallback is not treated the same as an unapproved one.
    const analysisSource = await detectAnalysisSourceWithApproval(prisma, tenderId, tender);
    // UNKNOWN means the tender has never been AI-analyzed AND has no approved fallback.
    // Treat it the same as an unapproved fallback: block full-proposal and add a blocker.
    const isUnapprovedFallback = analysisSource === "REGEX_FALLBACK_AI_ERROR" || analysisSource === "UNKNOWN";
    const isApprovedFallback = analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK";

    const submissionPlanBlocker = (!submissionPlanBuilt && requirementsExist && !isUnapprovedFallback)
      ? [{
          code: "FULL_PROPOSAL_SUBMISSION_PLAN_MISSING",
          message: "Full proposal generation is blocked: submission plan has not been built. Run Build Plan to generate the required file list before generating documents.",
          nextAction: "BUILD_SUBMISSION_PLAN",
        }]
      : [];

    const fullProposalBlockers = isUnapprovedFallback
      ? [{
          code: analysisSource === "UNKNOWN" ? "FULL_PROPOSAL_NOT_ANALYZED" : "FULL_PROPOSAL_REGEX_FALLBACK_ANALYSIS",
          message: analysisSource === "UNKNOWN"
            ? "Full proposal generation is blocked because this tender has not been analyzed. Run AI Analyze first."
            : "Full proposal generation is blocked because the latest analysis used regex fallback and has not been human-approved. Re-run AI Analyze with healthy providers, or approve the fallback analysis via the tender dashboard.",
          nextAction: "RETRY_AI_ANALYZE",
        }, ...readiness.fullProposalBlockers]
      : [...submissionPlanBlocker, ...readiness.fullProposalBlockers];

    const warnings = (isUnapprovedFallback || isApprovedFallback)
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
    // Approved fallback allows support packages but not full proposal without further review
    const readyForFullProposal = Boolean(readiness.fullProposalReady) && !isUnapprovedFallback;

    const analysisSourceGate = isUnapprovedFallback
      ? analysisSource === "UNKNOWN" ? "NOT_ANALYZED" : "BLOCKED_REGEX_FALLBACK"
      : isApprovedFallback
        ? "ALLOWED_APPROVED_FALLBACK"
        : "OK";

    const readyForFullProposalFinal = readyForFullProposal && submissionPlanBlocker.length === 0;

    return NextResponse.json({
      ...readiness,
      warnings,
      fullProposalBlockers,
      supportPackageReady: readyForSupportPackage,
      fullProposalReady: readyForFullProposalFinal,
      ready: readyForFullProposalFinal,
      readyForSupportPackage,
      readyForFullProposal: readyForFullProposalFinal,
      readyForAnySafeGeneration: readyForSupportPackage || readyForFullProposalFinal,
      analysisSourceGate,
      analysisSource,
      submissionPlanBuilt,
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
        fullProposalReady: "main proposal generation readiness; blocked when analysis is unapproved regex fallback",
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
      message: error instanceof Error ? error.message : String(error),
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
