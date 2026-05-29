import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getTenderGenerationReadiness } from "../../../../../lib/tender-generation-readiness";
import { detectAnalysisSourceWithApproval } from "../../../../../lib/engine/analysis-source";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id: tenderId } = await params;
  const [readiness, tender] = await Promise.all([
    getTenderGenerationReadiness(prisma, userId, tenderId),
    prisma.tender.findFirst({ where: { id: tenderId, userId }, select: { notes: true } }),
  ]);
  if (!readiness || !tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  // Use the canonical helper which checks both tender.notes AND the
  // ANALYSIS_APPROVAL:REGEX_FALLBACK ComplianceGap so a human-approved
  // fallback is not treated the same as an unapproved one.
  const analysisSource = await detectAnalysisSourceWithApproval(prisma, tenderId, tender);
  const isUnapprovedFallback = analysisSource === "REGEX_FALLBACK_AI_ERROR";
  const isApprovedFallback = analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK";

  const fullProposalBlockers = isUnapprovedFallback
    ? [{
        code: "FULL_PROPOSAL_REGEX_FALLBACK_ANALYSIS",
        message: "Full proposal generation is blocked because the latest analysis used regex fallback and has not been human-approved. Re-run AI Analyze with healthy providers, or approve the fallback analysis via the tender dashboard.",
        nextAction: "RETRY_AI_ANALYZE",
      }, ...readiness.fullProposalBlockers]
    : readiness.fullProposalBlockers;

  const warnings = (isUnapprovedFallback || isApprovedFallback)
    ? [{
        code: isApprovedFallback ? "ANALYSIS_USED_APPROVED_REGEX_FALLBACK" : "ANALYSIS_USED_REGEX_FALLBACK",
        message: isApprovedFallback
          ? "Latest analysis used regex fallback (human-approved). Verify forms, scoring, and submission rules carefully before final export."
          : "Latest analysis used regex fallback. Review forms, scoring, file names, submission rules, and expert/project requirements before relying on the result.",
        nextAction: isApprovedFallback ? "REVIEW_ANALYSIS" : "RETRY_AI_ANALYZE",
      }, ...readiness.warnings]
    : readiness.warnings;

  const readyForSupportPackage = Boolean(readiness.supportPackageReady);
  // Approved fallback allows support packages but not full proposal without further review
  const readyForFullProposal = Boolean(readiness.fullProposalReady) && !isUnapprovedFallback;

  const analysisSourceGate = isUnapprovedFallback
    ? "BLOCKED_REGEX_FALLBACK"
    : isApprovedFallback
      ? "ALLOWED_APPROVED_FALLBACK"
      : "OK";

  return NextResponse.json({
    ...readiness,
    warnings,
    fullProposalBlockers,
    supportPackageReady: readyForSupportPackage,
    fullProposalReady: readyForFullProposal,
    ready: readyForFullProposal,
    readyForSupportPackage,
    readyForFullProposal,
    readyForAnySafeGeneration: readyForSupportPackage || readyForFullProposal,
    analysisSourceGate,
    analysisSource,
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
}
