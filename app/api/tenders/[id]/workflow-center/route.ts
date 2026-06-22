import { NextRequest, NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";
import { resolveTenderAnalysisState } from "../../../../../lib/engine/analysis-state-resolver";
import { resolveMetadataTruth } from "../../../../../lib/engine/analysis/metadata-truth";
import { resolvePlanTruth } from "../../../../../lib/engine/analysis/plan-truth";
import { resolveAuthorityTruth } from "../../../../../lib/engine/analysis/authority-truth";
import { getCanonicalTenderWorkflowState } from "../../../../../lib/engine/workflow/workflow-state";
import { reportError } from "../../../../../lib/observability";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER").catch(() => null);
    if (!actor) return unauthorizedResponse();

    const { id: tenderId } = await params;

    const [analysis, metadata, plan, authority, workflow] = await Promise.all([
      resolveTenderAnalysisState(prisma, tenderId, actor.id),
      resolveMetadataTruth(prisma, tenderId, actor.id),
      resolvePlanTruth(prisma, tenderId, actor.id),
      resolveAuthorityTruth(prisma, tenderId, actor.id),
      getCanonicalTenderWorkflowState(prisma, actor.id, tenderId)
    ]);

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
        status: (analysis.state === "AI_SUCCEEDED" || analysis.state === "HUMAN_APPROVED_FALLBACK") ? "READY" : analysis.state === "RUNNING" ? "IN_PROGRESS" : "BLOCKED",
        explanation: analysis.safeDiagnosticSummary,
        actionLabel: analysis.nextAction ?? "Run AI Analyze"
      },
      {
        stage: 4,
        label: "Confirm Requirements",
        status: (analysis.state === "AI_SUCCEEDED" || analysis.state === "HUMAN_APPROVED_FALLBACK") ? "READY" : "PENDING",
        explanation: `${analysis.requirementsPersisted} requirements recorded.`,
        actionLabel: "Review Requirements"
      },
      {
        stage: 5,
        label: "Confirm Metadata",
        status: metadata.readinessScore > 0.8 ? "READY" : "WARNING",
        explanation: `Metadata coverage is ${Math.round(metadata.readinessScore * 100)}%.`,
        actionLabel: "Edit Metadata"
      },
      {
        stage: 6,
        label: "Verified Submission Plan",
        status: plan.isVerified ? "READY" : "BLOCKED",
        explanation: plan.reason,
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
        status: workflow.readyForGeneration ? "READY" : "BLOCKED",
        explanation: workflow.reason,
        actionLabel: "Generate"
      },
      {
        stage: 9,
        label: "Validate and Approve",
        status: authority.status === "AUTHORITY_READY" ? "READY" : "PENDING",
        explanation: authority.reason,
        actionLabel: "Review Documents"
      },
      {
        stage: 10,
        label: "Export ZIP",
        status: workflow.readyForExport ? "READY" : "BLOCKED",
        explanation: "Final finalization and download.",
        actionLabel: "Export"
      }
    ];

    return NextResponse.json({
      ok: true,
      analysis,
      metadata,
      plan,
      authority,
      workflow,
      stages
    });
  } catch (error) {
    void reportError(error, { route: "/api/tenders/[id]/workflow-center" });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
