import { logger } from "../../../../../lib/observability";
import { NextRequest, NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";
import { getTenderReleaseSnapshot } from "../../../../../lib/engine/tender-release-snapshot";
import { getCanonicalTenderWorkflowState } from "../../../../../lib/engine/workflow/workflow-state";
import { isMutationAction } from "../../../../../lib/recovery-command-actions";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER").catch(() => null);
    if (!actor) return unauthorizedResponse();

    const { id: tenderId } = await params;

    const [snapshot, workflow] = await Promise.all([
      getTenderReleaseSnapshot(prisma, tenderId, actor.id),
      getCanonicalTenderWorkflowState(prisma, actor.id, tenderId)
    ]);

    if (!snapshot) {
      return NextResponse.json({ error: "Tender not found" }, { status: 404 });
    }

    // ─── Page Ledger summary for extraction stage ──────────────────────────
    // Surface page coverage (e.g. "4/7 pages (57%) — Missing: 5, 6, 7") so
    // the user knows exactly what's incomplete before running AI Analyze.
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

    // Each stage maps its actionLabel to a recovery-command action name so the
    // server can classify it as mutation or read-only. The client receives
    // actionKind: "mutation" | "readonly" and uses it to HIDE mutation controls
    // for REVIEWER — no URL inference on the client.
    const stages = [
      {
        stage: 1,
        label: "Source Files",
        status: workflow.extractionState === "READY" ? "READY" : "WARNING",
        explanation: "Manage uploaded tender PDFs and DOCX files.",
        actionLabel: "Manage Files",
        actionName: "UPLOAD_TENDER_DOCUMENT",
        actionKind: isMutationAction("UPLOAD_TENDER_DOCUMENT") ? "mutation" as const : "readonly" as const,
      },
      {
        stage: 2,
        label: "Extraction Quality",
        status: hasUnsafePages ? "BLOCKED" : workflow.extractionState === "READY" ? "READY" : "BLOCKED",
        explanation: hasUnsafePages
          ? pageLedgerSummary.map(pl => `${pl.fileName}: ${pl.summary}`).join(" | ")
          : "Verify text density and page coverage.",
        blocker: hasUnsafePages
          ? pageLedgerSummary.filter(pl => !pl.isSafeForAnalysis).map(pl => pl.summary).join(" | ")
          : workflow.extractionState !== "READY" ? "Extraction inconsistent or weak." : undefined,
        actionLabel: "Repair Extraction",
        actionName: "REPAIR_EXTRACTION",
        actionKind: isMutationAction("REPAIR_EXTRACTION") ? "mutation" as const : "readonly" as const,
        pageLedgers: pageLedgerSummary,
      },
      {
        stage: 3,
        label: "AI Analyze",
        status: snapshot.analysis.state === "AI_SUCCEEDED" ? "READY" : snapshot.analysis.state === "RUNNING" ? "IN_PROGRESS" : "BLOCKED",
        explanation: snapshot.analysis.blocker ?? "AI Analyze pending or failed.",
        actionLabel: "Run AI Analyze",
        actionName: "RUN_AI_ANALYZE",
        actionKind: isMutationAction("RUN_AI_ANALYZE") ? "mutation" as const : "readonly" as const,
      },
      {
        stage: 4,
        label: "Confirm Requirements",
        status: snapshot.analysis.state === "AI_SUCCEEDED" ? "READY" : "PENDING",
        explanation: `${snapshot.requirements.total} requirements recorded (${snapshot.requirements.groundedMandatory} grounded).`,
        actionLabel: "Review Requirements",
        actionName: "REVIEW_MATCHES",
        actionKind: isMutationAction("REVIEW_MATCHES") ? "mutation" as const : "readonly" as const,
      },
      {
        stage: 5,
        label: "Tender Details",
        // Gate parity: a stage must never show READY while the generation
        // gate's metadata check (snapshot.metadata.gateValid — the SAME pure
        // validator the gate runs) would block. The >80%-valid ratio only
        // distinguishes READY from WARNING once the gate check passes.
        status: !snapshot.metadata.gateValid
          ? "BLOCKED"
          : snapshot.metadata.totalFields > 0 && snapshot.metadata.validFields / snapshot.metadata.totalFields > 0.8 ? "READY" : "WARNING",
        explanation: `Tender Details: ${snapshot.metadata.validFields} / ${snapshot.metadata.totalFields} valid (${snapshot.metadata.blockedFields} blocked).`,
        blocker: !snapshot.metadata.gateValid ? (snapshot.metadata.gateBlocker ?? "Critical metadata evidence is invalid or ungrounded.") : undefined,
        actionLabel: "Edit Tender Details",
        actionName: "EDIT_TENDER_METADATA",
        actionKind: isMutationAction("EDIT_TENDER_METADATA") ? "mutation" as const : "readonly" as const,
      },
      {
        stage: 6,
        label: "Verified Submission Plan",
        // Gate parity: buildPlan.valid is count-based (≥1 non-SUPERSEDED
        // GeneratedDocument) and explicitly does NOT agree with the gate —
        // gateValid mirrors the generation gate's strict confirmed-plan check.
        status: snapshot.buildPlan.gateValid ? "READY" : "BLOCKED",
        explanation: snapshot.buildPlan.gateBlocker ?? snapshot.buildPlan.blocker ?? "Build plan pending.",
        actionLabel: "Build Plan",
        actionName: "BUILD_SUBMISSION_PLAN",
        actionKind: isMutationAction("BUILD_SUBMISSION_PLAN") ? "mutation" as const : "readonly" as const,
      },
      {
        stage: 7,
        label: "Match Evidence",
        status: "PENDING",
        explanation: "Link experts and project experience to requirements.",
        actionLabel: "Match Evidence",
        actionName: "LINK_VAULT_EVIDENCE",
        actionKind: isMutationAction("LINK_VAULT_EVIDENCE") ? "mutation" as const : "readonly" as const,
      },
      {
        stage: 8,
        label: "Generate Documents",
        status: snapshot.generationEligible ? "READY" : "BLOCKED",
        explanation: snapshot.generationBlockers.length > 0 ? snapshot.generationBlockers[0] : "Ready for generation.",
        actionLabel: "Generate",
        actionName: "GENERATE_REQUIRED_DOCUMENTS",
        actionKind: isMutationAction("GENERATE_REQUIRED_DOCUMENTS") ? "mutation" as const : "readonly" as const,
      },
      {
        stage: 9,
        label: "Validate and Approve",
        status: "PENDING",
        explanation: "Review and approve generated documents.",
        actionLabel: "Review Documents",
        actionName: "VALIDATE_DOCS",
        actionKind: isMutationAction("VALIDATE_DOCS") ? "mutation" as const : "readonly" as const,
      },
      {
        stage: 10,
        label: "Export ZIP",
        status: snapshot.exportEligible ? "READY" : "BLOCKED",
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
      stages,
      classification: classificationSummary,
      pageLedgers: pageLedgerSummary,
    });
  } catch (error) {
    logger.error("[workflow-center]", { detail: error });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
