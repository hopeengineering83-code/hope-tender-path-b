import { logger } from "../../../../../lib/observability";
import { NextRequest, NextResponse } from "next/server";
import { requireRole, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getTenderReleaseSnapshot } from "../../../../../lib/engine/tender-release-snapshot";
import { getCanonicalTenderWorkflowState } from "../../../../../lib/engine/workflow/workflow-state";
import { getCanonicalTenderWorkflowDecision } from "../../../../../lib/engine/canonical-workflow-decision";
import { isMutationAction } from "../../../../../lib/recovery-command-actions";
import { TENDER_WORKFLOW_STAGE_LABELS } from "../../../../../lib/tender-workflow-stages";

function stageStatusFromCanonical(
  canonicalState: string | undefined,
  fallback: string,
): string {
  if (!canonicalState) return fallback;
  return canonicalState;
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

    if (!snapshot) {
      return NextResponse.json({ error: "Tender not found" }, { status: 404 });
    }

    const pageLedgerSummary = (snapshot.pageLedgers ?? []).map((pageLedger, index) => {
      const fileName = snapshot.extraction.files[index]?.fileName ?? `File ${index + 1}`;
      return { fileName, ...pageLedger };
    });
    const hasUnsafePages = (snapshot.pageLedgers ?? []).some((pageLedger) => !pageLedger.isSafeForAnalysis);

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

    const ds = decision?.stageStates ?? {};
    const analysisExplanation = snapshot.analysis.state === "AI_SUCCEEDED"
      ? "AI analysis completed and is ready for requirement review."
      : snapshot.analysis.state === "RUNNING"
        ? "AI analysis is running."
        : snapshot.analysis.blocker ?? "AI analysis must be run or repaired.";
    const requirementExplanation = snapshot.requirements.mandatory > 0
      ? `${snapshot.requirements.total} requirements recorded; ${snapshot.requirements.groundedMandatory}/${snapshot.requirements.mandatory} mandatory requirements are source-traced.`
      : `${snapshot.requirements.total} requirements recorded; no mandatory requirements are currently identified.`;

    const stages = [
      {
        stage: 1,
        label: TENDER_WORKFLOW_STAGE_LABELS[1],
        status: stageStatusFromCanonical(ds["UPLOAD_TENDER"], snapshot.extraction.activeFileCount > 0 ? "COMPLETE" : "READY"),
        explanation: "Manage uploaded tender PDFs and DOCX files.",
        actionLabel: "Manage Files",
        actionName: "UPLOAD_TENDER_DOCUMENT",
        actionKind: isMutationAction("UPLOAD_TENDER_DOCUMENT") ? "mutation" as const : "readonly" as const,
      },
      {
        stage: 2,
        label: TENDER_WORKFLOW_STAGE_LABELS[2],
        status: stageStatusFromCanonical(ds["FIX_EXTRACTION"], hasUnsafePages ? "BLOCKED" : snapshot.extraction.overallOk ? "COMPLETE" : "BLOCKED"),
        explanation: hasUnsafePages
          ? pageLedgerSummary.map((pageLedger) => `${pageLedger.fileName}: ${pageLedger.summary}`).join(" | ")
          : "Verify text density and page coverage.",
        blocker: hasUnsafePages
          ? pageLedgerSummary.filter((pageLedger) => !pageLedger.isSafeForAnalysis).map((pageLedger) => pageLedger.summary).join(" | ")
          : !snapshot.extraction.overallOk ? (snapshot.extraction.blocker ?? "Extraction inconsistent or weak.") : undefined,
        actionLabel: "Repair Extraction",
        actionName: "REPAIR_EXTRACTION",
        actionKind: isMutationAction("REPAIR_EXTRACTION") ? "mutation" as const : "readonly" as const,
        pageLedgers: pageLedgerSummary,
      },
      {
        stage: 3,
        label: TENDER_WORKFLOW_STAGE_LABELS[3],
        status: stageStatusFromCanonical(
          ds["RUN_AI_ANALYZE"],
          snapshot.analysis.state === "AI_SUCCEEDED"
            ? "COMPLETE"
            : snapshot.analysis.state === "RUNNING"
              ? "IN_PROGRESS"
              : "BLOCKED",
        ),
        explanation: analysisExplanation,
        actionLabel: decision?.partialAnalysis ? "Resume AI Analyze" : "Run AI Analyze",
        actionName: decision?.partialAnalysis ? "RESUME_AI_ANALYZE" : "RUN_AI_ANALYZE",
        actionKind: isMutationAction(decision?.partialAnalysis ? "RESUME_AI_ANALYZE" : "RUN_AI_ANALYZE") ? "mutation" as const : "readonly" as const,
      },
      {
        stage: 4,
        label: TENDER_WORKFLOW_STAGE_LABELS[4],
        status: stageStatusFromCanonical(
          ds["CONFIRM_REQUIREMENTS"],
          snapshot.analysis.state === "AI_SUCCEEDED" ? "READY" : "WAITING_ON_PRIOR_STEP",
        ),
        explanation: requirementExplanation,
        actionLabel: "Review Requirements",
        actionName: "REVIEW_MATCHES",
        actionKind: isMutationAction("REVIEW_MATCHES") ? "mutation" as const : "readonly" as const,
      },
      {
        stage: 5,
        label: TENDER_WORKFLOW_STAGE_LABELS[5],
        status: snapshot.metadata.totalFields > 0 && snapshot.metadata.validFields / snapshot.metadata.totalFields > 0.8 ? "READY" : "WARNING",
        explanation: `Tender Details: ${snapshot.metadata.validFields} / ${snapshot.metadata.totalFields} valid (${snapshot.metadata.blockedFields} blocked).`,
        actionLabel: "Edit Tender Details",
        actionName: "EDIT_TENDER_METADATA",
        actionKind: isMutationAction("EDIT_TENDER_METADATA") ? "mutation" as const : "readonly" as const,
      },
      {
        stage: 6,
        label: TENDER_WORKFLOW_STAGE_LABELS[6],
        status: stageStatusFromCanonical(
          ds["BUILD_SUBMISSION_PLAN"],
          snapshot.buildPlan.gateValid ? "COMPLETE" : "BLOCKED",
        ),
        explanation: snapshot.buildPlan.gateBlocker ?? snapshot.buildPlan.blocker ?? "Build plan pending.",
        actionLabel: "Build Plan",
        actionName: "BUILD_SUBMISSION_PLAN",
        actionKind: isMutationAction("BUILD_SUBMISSION_PLAN") ? "mutation" as const : "readonly" as const,
      },
      {
        stage: 7,
        label: TENDER_WORKFLOW_STAGE_LABELS[7],
        status: stageStatusFromCanonical(ds["MATCH_EVIDENCE"], "WAITING_ON_PRIOR_STEP"),
        explanation: decision?.currentBlockingStage && decision.currentBlockingStage !== "EXPORT_ZIP_READY" && decision.currentBlockingStage !== "MANDATORY_NO_COMPLIANCE_ROWS" && decision.currentBlockingStage !== "MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE"
          ? `Waiting on earlier step: ${decision.nextRequiredActionLabel}.`
          : "Link reviewed experts and project experience to source-traced requirements.",
        actionLabel: "Match Evidence",
        actionName: "LINK_VAULT_EVIDENCE",
        actionKind: isMutationAction("LINK_VAULT_EVIDENCE") ? "mutation" as const : "readonly" as const,
      },
      {
        stage: 8,
        label: TENDER_WORKFLOW_STAGE_LABELS[8],
        status: stageStatusFromCanonical(
          ds["GENERATE_DOCUMENTS"],
          snapshot.generationEligible ? "READY" : "BLOCKED",
        ),
        explanation: snapshot.generationBlockers.length > 0 ? snapshot.generationBlockers[0] : "Ready for generation.",
        actionLabel: "Generate",
        actionName: "GENERATE_REQUIRED_DOCUMENTS",
        actionKind: isMutationAction("GENERATE_REQUIRED_DOCUMENTS") ? "mutation" as const : "readonly" as const,
      },
      {
        stage: 9,
        label: TENDER_WORKFLOW_STAGE_LABELS[9],
        status: stageStatusFromCanonical(ds["VALIDATE_DOCS"], "WAITING_ON_PRIOR_STEP"),
        explanation: decision?.currentBlockingStage && decision.currentBlockingStage !== "EXPORT_ZIP_READY" && decision.currentBlockingStage !== "DOCS_NOT_VALIDATED" && decision.currentBlockingStage !== "DOCS_NOT_APPROVED_EXPORT_READY" && decision.currentBlockingStage !== "AUTHORITY_OR_QUALITY_BLOCKERS"
          ? `Waiting on earlier step: ${decision.nextRequiredActionLabel}.`
          : "Review and approve generated documents.",
        actionLabel: "Review Documents",
        actionName: "VALIDATE_DOCS",
        actionKind: isMutationAction("VALIDATE_DOCS") ? "mutation" as const : "readonly" as const,
      },
      {
        stage: 10,
        label: TENDER_WORKFLOW_STAGE_LABELS[10],
        status: stageStatusFromCanonical(
          ds["EXPORT_ZIP"],
          snapshot.exportEligible ? "READY" : "BLOCKED",
        ),
        explanation: snapshot.exportBlockers.length > 0 ? snapshot.exportBlockers[0] : "Ready for export.",
        actionLabel: "Export",
        actionName: "DOWNLOAD_FINAL_ZIP",
        actionKind: isMutationAction("DOWNLOAD_FINAL_ZIP") ? "mutation" as const : "readonly" as const,
      },
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
    logger.error("[workflow-center]", { detail: error });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
