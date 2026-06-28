import { logger } from "../../../../../lib/observability";
import { NextRequest, NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";
import { getTenderReleaseSnapshot } from "../../../../../lib/engine/tender-release-snapshot";
import { getCanonicalTenderWorkflowState } from "../../../../../lib/engine/workflow/workflow-state";

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

    const stages = [
      {
        stage: 1,
        label: "Source Files",
        status: workflow.extractionState === "READY" ? "READY" : "WARNING",
        explanation: "Manage uploaded tender PDFs and DOCX files.",
        actionLabel: "Manage Files"
      },
      {
        stage: 2,
        label: "Extraction Quality",
        status: workflow.extractionState === "READY" ? "READY" : "BLOCKED",
        explanation: "Verify text density and page coverage.",
        blocker: workflow.extractionState !== "READY" ? "Extraction inconsistent or weak." : undefined,
        actionLabel: "Run OCR / Re-extract"
      },
      {
        stage: 3,
        label: "AI Analyze",
        status: snapshot.analysis.state === "AI_SUCCEEDED" ? "READY" : snapshot.analysis.state === "RUNNING" ? "IN_PROGRESS" : "BLOCKED",
        explanation: snapshot.analysis.blocker ?? "AI Analyze pending or failed.",
        actionLabel: "Run AI Analyze"
      },
      {
        stage: 4,
        label: "Confirm Requirements",
        status: snapshot.analysis.state === "AI_SUCCEEDED" ? "READY" : "PENDING",
        explanation: `${snapshot.requirements.total} requirements recorded (${snapshot.requirements.groundedMandatory} grounded).`,
        actionLabel: "Review Requirements"
      },
      {
        stage: 5,
        label: "Confirm Metadata",
        status: snapshot.metadata.totalFields > 0 && snapshot.metadata.validFields / snapshot.metadata.totalFields > 0.8 ? "READY" : "WARNING",
        explanation: `Metadata: ${snapshot.metadata.validFields} / ${snapshot.metadata.totalFields} valid (${snapshot.metadata.blockedFields} blocked).`,
        actionLabel: "Edit Metadata"
      },
      {
        stage: 6,
        label: "Verified Submission Plan",
        status: snapshot.buildPlan.valid ? "READY" : "BLOCKED",
        explanation: snapshot.buildPlan.blocker ?? "Build plan pending.",
        actionLabel: "Build Plan"
      },
      {
        stage: 7,
        label: "Match Evidence",
        status: "PENDING",
        explanation: "Link experts and project experience to requirements.",
        actionLabel: "Match Evidence"
      },
      {
        stage: 8,
        label: "Generate Documents",
        status: snapshot.generationEligible ? "READY" : "BLOCKED",
        explanation: snapshot.generationBlockers.length > 0 ? snapshot.generationBlockers[0] : "Ready for generation.",
        actionLabel: "Generate"
      },
      {
        stage: 9,
        label: "Validate and Approve",
        status: "PENDING",
        explanation: "Review and approve generated documents.",
        actionLabel: "Review Documents"
      },
      {
        stage: 10,
        label: "Export ZIP",
        status: snapshot.exportEligible ? "READY" : "BLOCKED",
        explanation: snapshot.exportBlockers.length > 0 ? snapshot.exportBlockers[0] : "Ready for export.",
        actionLabel: "Export"
      }
    ];

    return NextResponse.json({
      ok: true,
      snapshot,
      workflow,
      stages
    });
  } catch (error) {
    logger.error("[workflow-center]", { detail: error });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
