import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getFinalSubmissionReadiness } from "../../../../../lib/engine/final-submission-readiness";
import { isStrongSupportLevel, normalizeSupportLevel } from "../../../../../lib/engine/requirement-evidence-profile";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

function jsonError(message: string, status = 500, extra: Record<string, unknown> = {}) {
  const code = typeof extra.code === "string" ? extra.code : "EXPORT_READINESS_ERROR";
  return NextResponse.json({ ok: false, success: false, code, message, error: message, ...extra }, { status });
}

async function getStrongMandatoryEvidenceStats(tenderId: string) {
  const requirements = await prisma.tenderRequirement.findMany({
    where: { tenderId, priority: { in: ["MANDATORY", "CRITICAL"] } },
    select: {
      id: true,
      complianceMatrixRows: { select: { supportLevel: true } },
    },
  });
  const total = requirements.length;
  const covered = requirements.filter((requirement) =>
    requirement.complianceMatrixRows.some((row) => isStrongSupportLevel(normalizeSupportLevel(row.supportLevel))),
  ).length;
  return { total, covered, percent: total === 0 ? 0 : Math.round((covered / total) * 100) };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    let actor;
    try {
      actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
    }

    await prismaReady;
    const { id } = await params;
    const readiness = await getFinalSubmissionReadiness(prisma, { tenderId: id, userId: actor.id, requireFileContent: false });
    if (!readiness) return jsonError("Tender not found", 404, { code: "TENDER_NOT_FOUND" });

    // Reconcile the export blocker with the same normalized support-level logic
    // used by the Requirement Coverage panel. This prevents the UI contradiction
    // where the coverage panel shows FULL/SUBSTANTIAL reviewer evidence while
    // the export panel still reports 0/N strong evidence because it used a strict
    // string query rather than normalizeSupportLevel().
    const evidenceStats = await getStrongMandatoryEvidenceStats(id);
    const reconciledTenderBlockers = readiness.tenderLevelBlockers.filter((blocker) =>
      !(blocker.category === "MANDATORY_EVIDENCE_INCOMPLETE" && evidenceStats.total > 0 && evidenceStats.percent >= 50),
    );
    const reconciledOk = readiness.ok && readiness.documentBlockers.length === 0 && reconciledTenderBlockers.length === 0;

    // Canonical upstream trust flags for UI components that need to check
    // whether docs are stale or whether the submission plan is built.
    const submissionPlanBuilt = readiness.summary.planStatus !== "NO_PLAN_NO_DOCS" && readiness.summary.planStatus !== "NO_PLAN_WITH_ACTIVE_DOCS";
    const analysisSource = readiness.summary.analysisSource ?? "UNKNOWN";
    const analysisTrusted = analysisSource === "AI";
    // Documents are current only when the plan is built, analysis is trusted,
    // and docs are matched to the plan (not in PLAN_MISSING_DOCS state).
    const documentsCurrent = submissionPlanBuilt && analysisTrusted && readiness.summary.planStatus === "PLAN_MATCHED";

    return NextResponse.json({
      success: true,
      exportReadiness: {
        ok: reconciledOk,
        tender: readiness.tender,
        summary: {
          activeDocuments: readiness.summary.finalExportCandidates,
          workspaceDocuments: readiness.summary.workspaceDocuments,
          excludedInternalDrafts: readiness.summary.excludedInternalRows,
          documentBlockers: readiness.summary.documentBlockers,
          tenderLevelBlockers: reconciledTenderBlockers.length,
          advisoryWarnings: readiness.summary.advisoryWarnings,
          totalBlockers: readiness.summary.documentBlockers + reconciledTenderBlockers.length,
          finalExportCandidates: readiness.summary.finalExportCandidates,
          excludedInternalRows: readiness.summary.excludedInternalRows,
          missingContentCount: readiness.summary.missingContentCount,
          invalidSignatureCount: readiness.summary.invalidSignatureCount,
          hygieneIssueCount: readiness.summary.hygieneIssueCount,
          officialOriginalBlockers: readiness.summary.officialOriginalBlockers,
          envelopeBreakdown: readiness.summary.envelopeBreakdown,
          strictTwoEnvelope: readiness.summary.strictTwoEnvelope,
          packageMode: readiness.summary.packageMode,
          planStatus: readiness.summary.planStatus,
          analysisSource: readiness.summary.analysisSource,
          readinessScore: readiness.summary.readinessScore,
          missingRequiredDocuments: readiness.summary.missingRequiredDocuments,
          ungeneratedPlannedRequired: readiness.summary.ungeneratedPlannedRequired,
          qualityFailedDocuments: readiness.summary.qualityFailedDocuments,
          mandatoryEvidence: evidenceStats,
        },
        documentBlockers: readiness.documentBlockers,
        tenderLevelBlockers: reconciledTenderBlockers,
        advisoryWarnings: readiness.advisoryWarnings,
        message: readiness.message,
        submissionPlanBuilt,
        analysisTrusted,
        documentsCurrent,
      },
    });
  } catch (error) {
    logger.error("Export readiness route failed", { detail: error });
    return jsonError("Export-readiness route failed.", 500, {
      code: "EXPORT_READINESS_RUNTIME_ERROR",
    });
  }
}
