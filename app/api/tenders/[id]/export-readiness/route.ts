import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getFinalSubmissionReadiness } from "../../../../../lib/engine/final-submission-readiness";
import { buildPublicReadinessEnvelope } from "../../../../../lib/engine/public-readiness-envelope";
import { getFinalPackageReadinessModel } from "../../../../../lib/engine/final-package-readiness-model";
import { isStrongSupportLevel, normalizeSupportLevel } from "../../../../../lib/engine/requirement-evidence-profile";
import { safeApiError } from "../../../../../lib/engine/safe-api-error";
import { getCanonicalTenderWorkflowDecision } from "../../../../../lib/engine/canonical-workflow-decision";

export const dynamic = "force-dynamic";
// This route runs three aggregate readiness models concurrently
// (getFinalSubmissionReadiness, getFinalPackageReadinessModel,
// getCanonicalTenderWorkflowDecision) and then a further evidence-stats query
// over every mandatory requirement's compliance rows. That is the workload of
// the 60s tier (engine, download, generate), not of the 10s tier it was filed
// under alongside genuinely small readers.
//
// Observed on the exact-head Preview against a real tender (163 evidence
// records, 7 requirements, Neon pooled connection): the request was killed at
// its 10s cap and Vercel answered the owner with a raw
// FUNCTION_INVOCATION_TIMEOUT page — no JSON, no blocker list, nothing the
// Export Readiness panel can render. A readiness reader that cannot answer is
// worse than a slow one, because the owner cannot tell "not ready" from
// "route died".
export const maxDuration = 60;

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

    // Explicit owner-scoped existence check BEFORE invoking either readiness
    // model. getFinalPackageReadinessModel throws a generic Error("Tender
    // not found") for a missing/foreign tender; running it in Promise.all
    // before ownership was confirmed meant that throw propagated to the
    // outer catch -> safeApiError, which defaults to 500 -- so an invalid
    // UUID or another tenant's tender ID returned 500 instead of a clean,
    // non-enumerating 404. Also protects against leaking any detail beyond
    // "not found" for a foreign tender.
    const ownedTender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true } });
    if (!ownedTender) return jsonError("Tender not found", 404, { code: "TENDER_NOT_FOUND" });

    const [readiness, finalPackage, canonicalDecision] = await Promise.all([
      getFinalSubmissionReadiness(prisma, { tenderId: id, userId: actor.id, requireFileContent: false }),
      getFinalPackageReadinessModel(prisma, id, actor.id),
      getCanonicalTenderWorkflowDecision(prisma, actor.id, id),
    ]);
    if (!readiness) return jsonError("Tender not found", 404, { code: "TENDER_NOT_FOUND" });
    if (!canonicalDecision) return jsonError("Tender not found", 404, { code: "TENDER_NOT_FOUND" });

    // Reconcile the export blocker with the same normalized support-level logic
    // used by the Requirement Coverage panel.
    const evidenceStats = await getStrongMandatoryEvidenceStats(id);
    const reconciledTenderBlockers = readiness.tenderLevelBlockers.filter((blocker) =>
      !(blocker.category === "MANDATORY_EVIDENCE_INCOMPLETE" && evidenceStats.total > 0 && evidenceStats.percent >= 50),
    );
    // finalPackage.export.blockers (final-package-readiness-model.ts) and
    // reconciledTenderBlockers (final-submission-readiness.ts -- the engine
    // behind the canonical Tender Release State used by the tender
    // workspace/command-center/report) both independently detect "no
    // confirmed Build Plan exists": the former as NO_CONFIRMED_BUILD_PLAN,
    // the latter as NO_CURRENT_CONFIRMED_BUILD_PLAN. Confirmed by a real
    // cross-page comparison against a live seeded tender: this route (which
    // backs the Documents page and the Export Readiness panel) showed 10
    // canonical blockers while the Tender Release State showed 9 for the
    // identical tender at the identical moment. Drop the older engine's
    // duplicate here so this route's count and list agree with the
    // canonical Tender Release State; NO_CURRENT_CONFIRMED_BUILD_PLAN still
    // blocks export via reconciledTenderBlockers, so no gate is weakened.
    const hasCanonicalNoConfirmedBuildPlan = reconciledTenderBlockers.some(
      (blocker) => blocker.category === "NO_CURRENT_CONFIRMED_BUILD_PLAN",
    );
    const reconciledExportBlockers = finalPackage.export.blockers.filter(
      (blocker) => !(blocker.code === "NO_CONFIRMED_BUILD_PLAN" && hasCanonicalNoConfirmedBuildPlan),
    );
    const finalPackageDocumentBlockers = finalPackage.documents.blockers.length + reconciledExportBlockers.length;

    const submissionPlanBuilt = readiness.summary.planStatus !== "NO_PLAN_NO_DOCS" && readiness.summary.planStatus !== "NO_PLAN_WITH_ACTIVE_DOCS";
    const analysisSource = readiness.summary.analysisSource ?? "UNKNOWN";
    const analysisTrusted = analysisSource === "AI";
    const documentsCurrent = submissionPlanBuilt && analysisTrusted && readiness.summary.planStatus === "PLAN_MATCHED";

    const upstreamCanonicalStages = new Set([
      "NO_TENDER_FILE", "EXTRACTION_UNSAFE", "PARTIAL_AI_ANALYSIS", "STALE_ANALYSIS", "AI_ANALYZE_NOT_RUN",
      "ENGINE_RUN_FAILED", "CRITICAL_TENDER_DETAILS_INVALID", "REQUIREMENTS_NOT_SOURCE_GROUNDED",
      "NO_CONFIRMED_BUILD_PLAN", "MANDATORY_NO_COMPLIANCE_ROWS", "MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE",
    ]);
    const suppressDownstream = upstreamCanonicalStages.has(canonicalDecision.currentBlockingStage);
    const canonicalBlocker = canonicalDecision.currentBlockingStage === "EXPORT_ZIP_READY" ? [] : [{
      code: canonicalDecision.blockingStageCode,
      message: canonicalDecision.nextRequiredActionReason,
      nextAction: canonicalDecision.nextRequiredActionLabel,
      severity: "BLOCKER",
    }];
    // The canonical workflow is the primary authority. A stale independent
    // readiness model must never leave `ok: true` beside a current Engine
    // failure (the exact Preview 03b9c928 contradiction). Downstream counts are
    // hidden until reachable for the same reason their blocker rows are hidden.
    const visibleDocumentBlockerCount = suppressDownstream ? 0 : finalPackageDocumentBlockers;
    const visibleTenderBlockerCount = suppressDownstream ? canonicalBlocker.length : reconciledTenderBlockers.length;
    const reconciledOk = canonicalBlocker.length === 0
      && readiness.ok
      && finalPackageDocumentBlockers === 0
      && reconciledTenderBlockers.length === 0
      && finalPackage.export.zipReady;
    const publicBlockers = [
      ...canonicalBlocker,
      ...(suppressDownstream ? [] : finalPackage.documents.blockers),
      ...(suppressDownstream ? [] : reconciledExportBlockers),
      ...(suppressDownstream ? [] : reconciledTenderBlockers.map((blocker) => ({
        code: blocker.category,
        message: blocker.title,
        nextAction: blocker.recommendedAction ?? "Resolve tender-level blocker",
        severity: blocker.severity,
      }))),
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
      primaryBlockerReason: canonicalBlocker.length > 0 ? canonicalDecision.nextRequiredActionReason : readiness.summary.primaryBlockerReason,
      primaryFixAction: canonicalBlocker.length > 0 ? canonicalDecision.nextRequiredActionLabel : readiness.summary.primaryFixAction,
      requiredDocumentsTotal: readiness.summary.requiredDocumentsTotal,
      generatedDocumentsTotal: finalPackage.documents.generated.length,
      exportReadyDocumentsTotal: readiness.summary.exportReadyDocumentsTotal,
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
          documentBlockers: visibleDocumentBlockerCount,
          tenderLevelBlockers: visibleTenderBlockerCount,
          advisoryWarnings: readiness.summary.advisoryWarnings,
          totalBlockers: visibleDocumentBlockerCount + visibleTenderBlockerCount,
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
        // ── Structured blocker information ──────────────────────────────
        // The export-readiness panel needs structured blockers, not just a
        // generic "failed" message. These fields give the panel everything
        // it needs to show actionable guidance.
        primaryBlockerReason: (() => {
          if (canonicalBlocker.length > 0) return canonicalDecision.nextRequiredActionReason;
          if (!submissionPlanBuilt) return "No source-verified Build Plan for this revision. Run Engine uses the verified source and current AI analysis to create and verify it.";
          const ungenerated = finalPackage.documents.missingRequired.length;
          if (ungenerated > 0) return `${ungenerated} required document(s) are planned but not generated.`;
          if (finalPackageDocumentBlockers > 0) return `${finalPackageDocumentBlockers} document blocker(s) remain.`;
          if (reconciledTenderBlockers.length > 0) return reconciledTenderBlockers[0]?.title ?? "Tender-level blockers remain.";
          if (!readiness.ok) return "Export gate is not satisfied.";
          return null;
        })(),
        primaryFixAction: (() => {
          if (canonicalBlocker.length > 0) return canonicalDecision.nextRequiredActionLabel;
          if (!submissionPlanBuilt) return "Run Engine to create and source-verify the Build Plan automatically.";
          const ungenerated = finalPackage.documents.missingRequired.length;
          if (ungenerated > 0) return "Automatic post-Engine document generation is pending; resolve the canonical current blocker first.";
          if (finalPackageDocumentBlockers > 0) return "Resolve document blockers.";
          if (reconciledTenderBlockers.length > 0) return reconciledTenderBlockers[0]?.recommendedAction ?? "Resolve tender-level blockers.";
          if (!readiness.ok) return "Resolve all export gate blockers.";
          return null;
        })(),
        requiredDocumentsTotal: Math.max(finalPackage.documents.required.length, finalPackage.documents.planned.length),
        exportReadyDocumentsTotal: finalPackage.documents.exportReady.length,
        plannedRequiredDocuments: finalPackage.documents.planned.length,
      },
    });
  } catch (error) {
    return safeApiError("export-readiness", error);
  }
}
