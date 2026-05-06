// Evaluator Persona Simulator API endpoint (PR #251).
//
// POST /api/tenders/[id]/evaluator-simulation
//
// Triggers a 4-persona synthetic evaluator panel against the most-recent
// generated proposal markdown. Returns the SimulationResult: predicted
// overall score, verdict, per-persona assessments, top objections, top
// commendations.
//
// User must explicitly POST to this endpoint by clicking "Simulate Panel"
// — never auto-runs because each simulation makes 4 Claude calls.

import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../lib/auth";
import { simulateEvaluatorPanel } from "../../../../../lib/engine/evaluator-simulator";
import { logAction } from "../../../../../lib/audit";

// Long enough to accommodate 4 parallel Claude calls + JSON parsing
// + DB writes. On Vercel Hobby (60s cap) this is the maximum; Pro
// users can override AI_PROPOSAL_TIMEOUT_MS for headroom.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  const canSimulate = ["ADMIN", "PROPOSAL_MANAGER", "REVIEWER"].includes(actor.role);
  if (!canSimulate) return forbiddenResponse();

  const { id } = await params;
  await prismaReady;

  const tender = await prisma.tender.findFirst({
    where: { id, userId: actor.id },
    select: {
      id: true,
      title: true,
      evaluationMethodology: true,
      // intakeSummary holds the proposal markdown (set by /ai-proposal
      // route) OR — if /generate has run — we want the most recent
      // GENERATED main-proposal document content. We surface intakeSummary
      // as the lightweight markdown stand-in; for a richer pull, the
      // main DOCX content would need decoding which is out of scope here.
      intakeSummary: true,
    },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  if (!tender.intakeSummary || tender.intakeSummary.trim().length < 500) {
    return NextResponse.json({
      error: "Proposal markdown is too short to simulate. Run AI Proposal or Generate Docs first to produce a substantive proposal.",
      code: "NO_PROPOSAL",
    }, { status: 400 });
  }

  await logAction({
    userId: actor.id,
    action: "EVALUATOR_SIMULATION_RUN",
    entityType: "Tender",
    entityId: id,
    description: `${actor.email} ran evaluator panel simulation on tender "${tender.title}"`,
    metadata: { tenderId: id, proposalLength: tender.intakeSummary.length },
  });

  const result = await simulateEvaluatorPanel({
    tenderTitle: tender.title,
    proposalMarkdown: tender.intakeSummary,
    evaluationCriteria: tender.evaluationMethodology ?? "",
  });

  if (!result) {
    return NextResponse.json({
      error: "All four evaluator personas failed. Check Anthropic API key configuration and rate-limit status, then retry.",
      code: "ALL_PERSONAS_FAILED",
    }, { status: 502 });
  }

  return NextResponse.json({ simulation: result });
}
