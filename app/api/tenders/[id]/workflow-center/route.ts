import { logger } from "../../../../../lib/observability";
import { NextRequest, NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getTenderReleaseSnapshot } from "../../../../../lib/engine/tender-release-snapshot";
import { getCanonicalTenderWorkflowState } from "../../../../../lib/engine/workflow/workflow-state";
import { getCanonicalTenderWorkflowDecision } from "../../../../../lib/engine/canonical-workflow-decision";
import { isMutationAction } from "../../../../../lib/recovery-command-actions";

// Map the canonical decision's stageStates (READY/BLOCKED/BLOCKED_BY_PRIOR_STEP/
// WAITING_ON_PRIOR_STEP/COMPLETE/IN_PROGRESS) to the workflow-center status
// vocabulary. The canonical decision is the SINGLE source of stage truth —
// this route must NOT hardcode PENDING for any stage.
function stageStatusFromCanonical(
  canonicalState: string | undefined,
  fallback: string,
): string {
  if (!canonicalState) return fallback;
  // Pass through directly — the frontend handles all canonical states.
  // The canonical states are: READY, BLOCKED, BLOCKED_BY_PRIOR_STEP,
  // WAITING_ON_PRIOR_STEP, COMPLETE, IN_PROGRESS.
  return canonicalState;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER").catch(() => null);
    if (!actor) return unauthorizedResponse();

    const { id: tenderId } = await params;

    // Ensure the runtime schema bootstrap has completed before any DB query.
    await prismaReady;

    // The canonical decision is the SINGLE source of stage truth.
    // workflow-center still calls getCanonicalTenderWorkflowState for the
    // legacy readyFor* flags, but stage statuses come from the decision.
    const [snapshot, workflow, decision] = await Promise.all([
      getTenderReleaseSnapshot(prisma, tenderId, actor.id),
      getCanonicalTenderWorkflowState(prisma, actor.id, tenderId),
      getCanonicalTenderWorkflowDecision(prisma, actor.id, tenderId),
    ]);

    if (!snapshot) {
      return NextResponse.json({ error: "Tender not found" }, { status: 404 });
    }

    // ─── Page Ledger summary for extraction stage ──────────────────────────
    const pageLedgerSummary = (snapshot.pageLedgers ?? []).map((pl, i) => {
      const fileName = snapshot.extraction.files[i]?.fileName ?? `File ${i + 1}`;
      return { fileName, ...pl };
    });
    const hasUnsafePages = (snapshot.pageLedgers ?? []).some(pl => !pl.isSafeForAnalysis);

    // ─── Tender Classification summary ─────────────────────────────────────
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

    // ─── Per-stage status from the canonical decision ─────────────────────
    // Each stage's status is driven by decision.stageStates[stageKey]. When
    // the decision is null (tender not found /w owner scope), we fall back
    // to a safe default — never the old hardcoded PENDING.
    const ds = decision?.stageStates ?? {};

    // Each stage maps its actionLabel to a recovery-command action name so the
    // server can classify it as mutation or read-only. The client receives
    // actionKind: "mutation" | "readonly" and uses it to HIDE mutation controls
    // for REVIEWER — no URL inference on the client.
    const stages = [
      {
        stage: 1,
        label: "Source Files",
        status: stageStatusFromCanonical(ds["UPLOAD_TENDER"], snapshot.extraction.activeFileCount > 0 ? "COMPLETE" : "READY"),
        explanation: "Manage uploaded tender PDFs and DOCX files.",
        actionLabel: "Manage Files",
        actionName: "UPLOAD_TENDER_DOCUMENT",
        actionKind: isMutationAction("UPLOAD_TENDER_DOCUMENT") ? "mutation" as const : "readonly" as const,
      },
      {
        stage: 2,
        label: "Extraction Quality",
        status: stageStatusFromCanonical(ds["FIX_EXTRACTION"], hasUnsafePages ? "BLOCKED" : snapshot.extraction.overallOk ? "COMPLETE" : "BLOCKED"),
        explanation: hasUnsafePages
          ? pageLedgerSummary.map(pl => `${pl.fileName}: ${pl.summary}`).join(" | ")
          : "Verify text density and page coverage.",
        blocker: hasUnsafePages
          ? pageLedgerSummary.filter(pl => !pl.isSafeForAnalysis).map(pl => pl.summary).join(" | ")
          : !snapshot.extraction.overallOk ? (snapshot.extraction.blocker ?? "Extraction inconsistent or weak.") : undefined,
        actionLabel: "Repair Extraction",
        actionName: "REPAIR_EXTRACTION",
        actionKind: isMutationAction("REPAIR_EXTRACTION") ? "mutation" as const : "readonly" as const,
        pageLedgers: pageLedgerSummary,
      },
      {
        stage: 3,
        label: "AI Analyze",
        status: stageStatusFromCanonical(ds["RUN_AI_ANALYZE"],
          snapshot.analysis.state === "AI_SUCCEEDED" ? "COMPLETE" :
          snapshot.analysis.state === "RUNNING" ? "IN_PROGRESS" : "BLOCKED"),
        explanation: snapshot.analysis.blocker ?? "AI Analyze pending or failed.",
        actionLabel: decision?.partialAnalysis ? "Resume AI Analyze" : "Run AI Analyze",
        actionName: decision?.partialAnalysis ? "RESUME_AI_ANALYZE" : "RUN_AI_ANALYZE",
        actionKind: isMutationAction(decision?.partialAnalysis ? "RESUME_AI_ANALYZE" : "RUN_AI_ANALYZE") ? "mutation" as const : "readonly" as const,
      },
      {
        stage: 4,
        label: "Confirm Requirements",
        status: stageStatusFromCanonical(ds["CONFIRM_REQUIREMENTS"],
          snapshot.analysis.state === "AI_SUCCEEDED" ? "READY" : "WAITING_ON_PRIOR_STEP"),
        explanation: `${snapshot.requirements.total} requirements recorded (${snapshot.requirements.groundedMandatory} grounded).`,
        actionLabel: "Review Requirements",
        actionName: "REVIEW_MATCHES",
        actionKind: isMutationAction("REVIEW_MATCHES") ? "mutation" as const : "readonly" as const,
      },
      {
        stage: 5,
        label: "Tender Details",
        // METADATA IS NO LONGER A HARD BLOCKER — the snapshot's metadata.gateValid
        // is always true per the unified runtime model. Tender Details are
        // advisory; the >80%-valid ratio only distinguishes READY from WARNING.
        status: snapshot.metadata.totalFields > 0 && snapshot.metadata.validFields / snapshot.metadata.totalFields > 0.8 ? "READY" : "WARNING",
        explanation: `Tender Details: ${snapshot.metadata.validFields} / ${snapshot.metadata.totalFields} valid (${snapshot.metadata.blockedFields} blocked).`,
        actionLabel: "Edit Tender Details",
        actionName: "EDIT_TENDER_METADATA",
        actionKind: isMutationAction("EDIT_TENDER_METADATA") ? "mutation" as const : "readonly" as const,
      },
      {
        stage: 6,
        label: "Verified Submission Plan",
        // Canonical decision drives status — uses gateValid (not the count-based
        // valid flag) so it agrees with the generation gate.
        status: stageStatusFromCanonical(ds["BUILD_SUBMISSION_PLAN"],
          snapshot.buildPlan.gateValid ? "COMPLETE" : "BLOCKED"),
        explanation: snapshot.buildPlan.gateBlocker ?? snapshot.buildPlan.blocker ?? "Build plan pending.",
        actionLabel: "Build Plan",
        actionName: "BUILD_SUBMISSION_PLAN",
        actionKind: isMutationAction("BUILD_SUBMISSION_PLAN") ? "mutation" as const : "readonly" as const,
      },
      {
        stage: 7,
        label: "Match Evidence",
        // NO LONGER hardcoded PENDING — driven by the canonical decision.
        // When upstream blockers exist, this shows BLOCKED_BY_PRIOR_STEP or
        // WAITING_ON_PRIOR_STEP so the user knows it is gated, not just "pending".
        status: stageStatusFromCanonical(ds["MATCH_EVIDENCE"], "WAITING_ON_PRIOR_STEP"),
        explanation: decision?.currentBlockingStage && decision.currentBlockingStage !== "EXPORT_ZIP_READY" && decision.currentBlockingStage !== "MANDATORY_NO_COMPLIANCE_ROWS" && decision.currentBlockingStage !== "MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE"
          ? `Waiting on earlier step: ${decision.nextRequiredActionLabel}.`
          : "Link experts and project experience to requirements.",
        actionLabel: "Match Evidence",
        actionName: "LINK_VAULT_EVIDENCE",
        actionKind: isMutationAction("LINK_VAULT_EVIDENCE") ? "mutation" as const : "readonly" as const,
      },
      {
        stage: 8,
        label: "Generate Documents",
        status: stageStatusFromCanonical(ds["GENERATE_DOCUMENTS"],
          snapshot.generationEligible ? "READY" : "BLOCKED"),
        explanation: snapshot.generationBlockers.length > 0 ? snapshot.generationBlockers[0] : "Ready for generation.",
        actionLabel: "Generate",
        actionName: "GENERATE_REQUIRED_DOCUMENTS",
        actionKind: isMutationAction("GENERATE_REQUIRED_DOCUMENTS") ? "mutation" as const : "readonly" as const,
      },
      {
        stage: 9,
        label: "Validate and Approve",
        // NO LONGER hardcoded PENDING — driven by the canonical decision.
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
        label: "Export ZIP",
        status: stageStatusFromCanonical(ds["EXPORT_ZIP"],
          snapshot.exportEligible ? "READY" : "BLOCKED"),
        explanation: snapshot.exportBlockers.length > 0 ? snapshot.exportBlockers[0] : "Ready for export.",
        actionLabel: "Export",
        actionName: "DOWNLOAD_FINAL_ZIP",
        actionKind: isMutationAction("DOWNLOAD_FINAL_ZIP") ? "mutation" as const : "readonly" as const,
      }
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
