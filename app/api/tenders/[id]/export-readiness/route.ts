import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getFinalSubmissionReadiness } from "../../../../../lib/engine/final-submission-readiness";
import { buildPublicReadinessEnvelope } from "../../../../../lib/engine/public-readiness-envelope";
import { getFinalPackageReadinessModel } from "../../../../../lib/engine/final-package-readiness-model";
import { isStrongSupportLevel, normalizeSupportLevel } from "../../../../../lib/engine/requirement-evidence-profile";
import { safeApiError } from "../../../../../lib/engine/safe-api-error";

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
    const [readiness, finalPackage] = await Promise.all([
      getFinalSubmissionReadiness(prisma, { tenderId: id, userId: actor.id, requireFileContent: false }),
      getFinalPackageReadinessModel(prisma, id, actor.id),
    ]);
    if (!readiness) return jsonError("Tender not found", 404, { code: "TENDER_NOT_FOUND" });

    // Reconcile the export blocker with the same normalized support-level logic
    // used by the Requirement Coverage panel.
    const evidenceStats = await getStrongMandatoryEvidenceStats(id);
    const reconciledTenderBlockers = readiness.tenderLevelBlockers.filter((blocker) =>
      !(blocker.category === "MANDATORY_EVIDENCE_INCOMPLETE" && evidenceStats.total > 0 && evidenceStats.percent >= 50),
    );
    const finalPackageDocumentBlockers = finalPackage.documents.blockers.length + finalPackage.export.blockers.length;
    const reconciledOk = readiness.ok && finalPackageDocumentBlockers === 0 && reconciledTenderBlockers.length === 0 && finalPackage.export.zipReady;

    const submissionPlanBuilt = readiness.summary.planStatus !== "NO_PLAN_NO_DOCS" && readiness.summary.planStatus !== "NO_PLAN_WITH_ACTIVE_DOCS";
    const analysisSource = readiness.summary.analysisSource ?? "UNKNOWN";
    const analysisTrusted = analysisSource === "AI";
    const documentsCurrent = submissionPlanBuilt && analysisTrusted && readiness.summary.planStatus === "PLAN_MATCHED";

    const publicBlockers = [
      ...finalPackage.documents.blockers,
      ...finalPackage.export.blockers,
      ...reconciledTenderBlockers.map((blocker) => ({
        code: blocker.category,
        message: blocker.title,
        nextAction: blocker.recommendedAction ?? "Resolve tender-level blocker",
        severity: blocker.severity,
      })),
    ];
    const publicWarnings = readiness.advisoryWarnings.map((warning) => ({
      code: warning.code ?? warning.category,
      message: warning.title,
      nextAction: warning.recommendedAction ?? null,
      severity: warning.severity,
    }));

    const envelope = buildPublicReadinessEnvelope({
      ok: reconciledOk,
      blockers: publicBlockers,
      warnings: publicWarnings,
      primaryBlockerReason: readiness.summary.primaryBlockerReason,
      primaryFixAction: readiness.summary.primaryFixAction,
      requiredDocumentsTotal: finalPackage.documents.required.length,
      generatedDocumentsTotal: finalPackage.documents.generated.length,
      exportReadyDocumentsTotal: finalPackage.documents.exportReady.length,
    });

    return NextResponse.json({
      ...envelope,
      success: true,
      exportReadiness: {
        ok: reconciledOk,
        tender: readiness.tender,
        summary: {
          activeDocuments: finalPackage.export.exportCandidateCount,
          workspaceDocuments: finalPackage.export.workspaceCount,
          excludedInternalDrafts: finalPackage.documents.extraGeneratedOutsidePlan.length,
          documentBlockers: finalPackageDocumentBlockers,
          tenderLevelBlockers: reconciledTenderBlockers.length,
          advisoryWarnings: readiness.summary.advisoryWarnings,
          totalBlockers: finalPackageDocumentBlockers + reconciledTenderBlockers.length,
          finalExportCandidates: finalPackage.export.exportCandidateCount,
          excludedInternalRows: finalPackage.documents.extraGeneratedOutsidePlan.length,
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
          missingRequiredDocuments: finalPackage.documents.missingRequired.length,
          ungeneratedPlannedRequired: finalPackage.documents.missingRequired.length,
          qualityFailedDocuments: readiness.summary.qualityFailedDocuments,
          mandatoryEvidence: evidenceStats,
        },
        documentBlockers: readiness.documentBlockers,
        finalPackageReadiness: finalPackage,
        tenderLevelBlockers: reconciledTenderBlockers,
        advisoryWarnings: readiness.advisoryWarnings,
        message: readiness.message,
        requiredDocuments: finalPackage.documents.required.length,
        generatedDocuments: finalPackage.documents.generated.length,
        exportReadyDocuments: finalPackage.documents.exportReady.length,
        finalPackageFacts: {
          zipReady: finalPackage.export.zipReady,
          plannedCount: finalPackage.documents.planned.length,
          missingCount: finalPackage.documents.missingRequired.length,
          exportCandidateCount: finalPackage.export.exportCandidateCount,
          supersededCount: finalPackage.documents.extraGeneratedOutsidePlan.length,
        },
        submissionPlanBuilt,
        analysisTrusted,
        documentsCurrent,
      },
    });
  } catch (error) {
    return safeApiError("export-readiness", error);
  }
}
