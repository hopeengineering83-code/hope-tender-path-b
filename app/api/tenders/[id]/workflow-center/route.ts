import { logger } from "../../../../../lib/observability";
import { NextRequest, NextResponse } from "next/server";
import { requireRole, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getTenderReleaseSnapshot } from "../../../../../lib/engine/tender-release-snapshot";
import { getCanonicalTenderWorkflowState } from "../../../../../lib/engine/workflow/workflow-state";
import { getCanonicalTenderWorkflowDecision } from "../../../../../lib/engine/canonical-workflow-decision";
import { TENDER_WORKFLOW_STAGE_LABELS } from "../../../../../lib/tender-workflow-stages";
import { getTenderAction, type TenderActionId } from "../../../../../lib/ui/action-registry";

function stageStatusFromCanonical(canonicalState: string | undefined, fallback: string): string {
  return canonicalState || fallback;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER").catch(() => null);
    if (!actor) return unauthorizedResponse();

    const { id: tenderId } = await params;
    await prismaReady;

    const [snapshot, workflow, decision] = await Promise.all([
      getTenderReleaseSnapshot(prisma, tenderId, actor.id),
      getCanonicalTenderWorkflowState(prisma, actor.id, tenderId),
      getCanonicalTenderWorkflowDecision(prisma, actor.id, tenderId),
    ]);

    if (!snapshot) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

    const pageLedgerSummary = (snapshot.pageLedgers ?? []).map((pageLedger, index) => ({
      fileName: snapshot.extraction.files[index]?.fileName ?? `File ${index + 1}`,
      ...pageLedger,
    }));
    const hasUnsafePages = (snapshot.pageLedgers ?? []).some((pageLedger) => !pageLedger.isSafeForAnalysis);
    const ds = decision?.stageStates ?? {};

    const classification = snapshot.tenderClassification;
    const classificationSummary = classification
      ? {
          tenderType: classification.tenderType,
          procurementStructure: classification.procurementStructure,
          companyServices: classification.companyServices,
          confidence: classification.confidence,
          tenderTypeEvidence: classification.tenderTypeEvidence,
          procurementStructureEvidence: classification.procurementStructureEvidence,
        }
      : null;

    const analysisExplanation = snapshot.analysis.state === "AI_SUCCEEDED"
      ? "AI analysis completed and the canonical successful revision is ready for requirement review."
      : snapshot.analysis.state === "RUNNING"
        ? "AI analysis is running automatically."
        : snapshot.analysis.blocker ?? "Automatic analysis is blocked and a recovery action is available.";

    const requirementExplanation = snapshot.requirements.mandatory > 0
      ? `${snapshot.requirements.total} requirements recorded; ${snapshot.requirements.groundedMandatory}/${snapshot.requirements.mandatory} mandatory requirements are source-traced.`
      : `${snapshot.requirements.total} requirements recorded; no mandatory requirements are currently identified.`;

    const evidenceRecoveryRequired = decision?.currentBlockingStage === "MANDATORY_NO_COMPLIANCE_ROWS" ||
      decision?.currentBlockingStage === "MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE";

    const stage = (
      number: number,
      status: string,
      explanation: string,
      actionId: TenderActionId,
      extra: Record<string, unknown> = {},
    ) => {
      const action = getTenderAction(actionId);
      return {
        stage: number,
        label: TENDER_WORKFLOW_STAGE_LABELS[number as keyof typeof TENDER_WORKFLOW_STAGE_LABELS],
        status,
        explanation,
        actionId,
        actionLabel: action.label,
        actionName: actionId,
        actionKind: "navigation" as const,
        actionTarget: action.anchor,
        actionAvailability: action.availability,
        mutation: action.mutation,
        mutationOwner: action.owner,
        iconName: action.iconName,
        ...extra,
      };
    };

    const stages = [
      stage(
        1,
        stageStatusFromCanonical(ds["UPLOAD_TENDER"], snapshot.extraction.activeFileCount > 0 ? "COMPLETE" : "READY"),
        "Upload the tender package once. The server owns all automatic continuation after upload.",
        "UPLOAD_TENDER_FILES",
      ),
      stage(
        2,
        stageStatusFromCanonical(ds["FIX_EXTRACTION"], hasUnsafePages ? "BLOCKED" : snapshot.extraction.overallOk ? "COMPLETE" : "BLOCKED"),
        hasUnsafePages
          ? pageLedgerSummary.map((item) => `${item.fileName}: ${item.summary}`).join(" | ")
          : "Text density and page coverage are verified automatically.",
        "REEXTRACT_SOURCE",
        {
          blocker: hasUnsafePages
            ? pageLedgerSummary.filter((item) => !item.isSafeForAnalysis).map((item) => item.summary).join(" | ")
            : !snapshot.extraction.overallOk ? snapshot.extraction.blocker ?? "Extraction inconsistent or weak." : undefined,
          pageLedgers: pageLedgerSummary,
        },
      ),
      stage(
        3,
        stageStatusFromCanonical(
          ds["RUN_AI_ANALYZE"],
          snapshot.analysis.state === "AI_SUCCEEDED" ? "COMPLETE" : snapshot.analysis.state === "RUNNING" ? "IN_PROGRESS" : "BLOCKED",
        ),
        analysisExplanation,
        "AI_ANALYZE",
      ),
      stage(
        4,
        stageStatusFromCanonical(ds["CONFIRM_REQUIREMENTS"], snapshot.analysis.state === "AI_SUCCEEDED" ? "READY" : "WAITING_ON_PRIOR_STEP"),
        requirementExplanation,
        "REVIEW_SOURCES",
      ),
      stage(
        5,
        snapshot.metadata.totalFields > 0 && snapshot.metadata.validFields / snapshot.metadata.totalFields > 0.8 ? "READY" : "WARNING",
        `Tender Details: ${snapshot.metadata.validFields} / ${snapshot.metadata.totalFields} valid (${snapshot.metadata.blockedFields} blocked).`,
        "OPEN_TENDER_SETTINGS",
      ),
      stage(
        6,
        stageStatusFromCanonical(ds["BUILD_SUBMISSION_PLAN"], snapshot.buildPlan.gateValid ? "COMPLETE" : "BLOCKED"),
        snapshot.buildPlan.gateBlocker ?? snapshot.buildPlan.blocker ?? "Submission plan pending.",
        "BUILD_SUBMISSION_PLAN",
      ),
      stage(
        7,
        stageStatusFromCanonical(ds["MATCH_EVIDENCE"], "WAITING_ON_PRIOR_STEP"),
        decision?.currentBlockingStage && !["EXPORT_ZIP_READY", "MANDATORY_NO_COMPLIANCE_ROWS", "MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE"].includes(decision.currentBlockingStage)
          ? `Waiting on earlier step: ${decision.nextRequiredActionLabel}.`
          : "Review automatically matched source-verified or human-reviewed company evidence.",
        evidenceRecoveryRequired ? "MATCH_EVIDENCE" : "REVIEW_EVIDENCE",
      ),
      stage(
        8,
        stageStatusFromCanonical(ds["GENERATE_DOCUMENTS"], snapshot.generationEligible ? "READY" : "BLOCKED"),
        snapshot.generationBlockers[0] ?? "Ready to generate only tender-required documents.",
        "GENERATE_REQUIRED_DOCUMENTS",
      ),
      stage(
        9,
        stageStatusFromCanonical(ds["VALIDATE_DOCS"], "WAITING_ON_PRIOR_STEP"),
        decision?.currentBlockingStage && !["EXPORT_ZIP_READY", "DOCS_NOT_VALIDATED", "DOCS_NOT_APPROVED_EXPORT_READY", "AUTHORITY_OR_QUALITY_BLOCKERS"].includes(decision.currentBlockingStage)
          ? `Waiting on earlier step: ${decision.nextRequiredActionLabel}.`
          : "Validate generated documents and complete genuine final approval.",
        "FINAL_APPROVAL",
      ),
      stage(
        10,
        stageStatusFromCanonical(ds["EXPORT_ZIP"], snapshot.exportEligible ? "READY" : "BLOCKED"),
        snapshot.exportBlockers[0] ?? "Ready for byte-verified final ZIP export.",
        "DOWNLOAD_FINAL_ZIP",
      ),
    ];

    return NextResponse.json({
      ok: true,
      snapshot,
      workflow,
      decision: decision ?? undefined,
      stages,
      classification: classificationSummary,
      pageLedgers: pageLedgerSummary,
    });
  } catch (error) {
    logger.error("[workflow-center]", {
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
