import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getTenderGenerationReadiness } from "../../../../../lib/tender-generation-readiness";

export const dynamic = "force-dynamic";

function hasRegexFallbackSource(notes?: string | null): boolean {
  return /analysis source:\s*regex fallback/i.test(notes ?? "");
}

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

  const regexFallback = hasRegexFallbackSource(tender.notes);
  const fullProposalBlockers = regexFallback
    ? [{
        code: "FULL_PROPOSAL_REGEX_FALLBACK_ANALYSIS",
        message: "Full proposal generation is blocked because the latest analysis used regex fallback. Re-run Engine with a healthy AI provider before final proposal generation.",
        nextAction: "RUN_ENGINE",
      }, ...readiness.fullProposalBlockers]
    : readiness.fullProposalBlockers;
  const warnings = regexFallback
    ? [{
        code: "ANALYSIS_USED_REGEX_FALLBACK",
        message: "Latest analysis used regex fallback. Review forms, scoring, file names, submission rules, and expert/project requirements before relying on the result.",
        nextAction: "RUN_ENGINE",
      }, ...readiness.warnings]
    : readiness.warnings;

  const readyForSupportPackage = Boolean(readiness.supportPackageReady);
  const readyForFullProposal = Boolean(readiness.fullProposalReady) && !regexFallback;

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
    analysisSourceGate: regexFallback ? "BLOCKED_REGEX_FALLBACK" : "OK",
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
      fullProposalReady: "main proposal generation readiness; blocked when latest analysis source is regex fallback",
      finalExportReady: "not evaluated by generation-readiness; check links.exportReadiness or the dashboard export-readiness panel",
    },
  });
}
