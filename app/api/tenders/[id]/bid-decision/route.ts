import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { evaluateBidDecision } from "../../../../../lib/engine/bid-decision";
import { logAction } from "../../../../../lib/audit";

export const dynamic = "force-dynamic";

function appendBidDecisionNote(existingNotes: string | null, summary: string): string {
  const line = `Bid decision: ${summary}`;
  if (!existingNotes?.trim()) return line;
  const withoutOld = existingNotes
    .split("\n")
    .filter((part) => !part.startsWith("Bid decision:"))
    .join("\n")
    .trim();
  return [withoutOld, line].filter(Boolean).join("\n");
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  await prismaReady;
  const { id } = await params;
  const tender = await prisma.tender.findFirst({
    where: { id, userId: actor.id },
    include: {
      requirements: { select: { priority: true, requirementType: true, title: true, description: true } },
      complianceGaps: { select: { severity: true, isResolved: true, title: true } },
      expertMatches: { select: { score: true, isSelected: true } },
      projectMatches: { select: { score: true, isSelected: true } },
      generatedDocuments: { select: { generationStatus: true, reviewStatus: true } },
    },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const decision = evaluateBidDecision({
    deadline: tender.deadline,
    budget: tender.budget,
    requirements: tender.requirements,
    complianceGaps: tender.complianceGaps,
    expertMatches: tender.expertMatches,
    projectMatches: tender.projectMatches,
    generatedDocuments: tender.generatedDocuments,
  });

  return NextResponse.json({ success: true, decision });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  await prismaReady;
  const { id } = await params;
  const body = await req.json().catch(() => ({} as { overrideDecision?: string; overrideReason?: string }));

  const tender = await prisma.tender.findFirst({
    where: { id, userId: actor.id },
    include: {
      requirements: { select: { priority: true, requirementType: true, title: true, description: true } },
      complianceGaps: { select: { severity: true, isResolved: true, title: true } },
      expertMatches: { select: { score: true, isSelected: true } },
      projectMatches: { select: { score: true, isSelected: true } },
      generatedDocuments: { select: { generationStatus: true, reviewStatus: true } },
    },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const evaluated = evaluateBidDecision({
    deadline: tender.deadline,
    budget: tender.budget,
    requirements: tender.requirements,
    complianceGaps: tender.complianceGaps,
    expertMatches: tender.expertMatches,
    projectMatches: tender.projectMatches,
    generatedDocuments: tender.generatedDocuments,
  });

  const overrideDecision = ["BID", "BID_WITH_CONDITIONS", "NO_BID"].includes(body.overrideDecision ?? "") ? body.overrideDecision : null;
  if (overrideDecision && !body.overrideReason?.trim()) {
    return NextResponse.json({ error: "Override reason is required when overriding the evaluated bid decision." }, { status: 400 });
  }

  const decision = overrideDecision ? { ...evaluated, decision: overrideDecision as typeof evaluated.decision, summary: `${overrideDecision.replace(/_/g, " ")} — manual override from evaluated ${evaluated.decision} at ${evaluated.score}/100. ${body.overrideReason}` } : evaluated;
  const nextStatus = decision.decision === "NO_BID" ? "NO_BID" : decision.decision === "BID_WITH_CONDITIONS" ? "COMPLIANCE_REVIEW" : tender.status;
  const nextStage = decision.decision === "NO_BID" ? "BID_DECISION" : tender.stage === "TENDER_INTAKE" ? "MATCHING" : tender.stage;

  await prisma.tender.update({
    where: { id },
    data: {
      status: nextStatus,
      stage: nextStage,
      notes: appendBidDecisionNote(tender.notes, decision.summary),
    },
  });

  await logAction({
    userId: actor.id,
    action: "TENDER_BID_DECISION_APPLIED",
    entityType: "Tender",
    entityId: id,
    description: `${actor.email} applied bid decision ${decision.decision} for "${tender.title}" (${decision.score}/100)`,
    metadata: {
      tenderId: id,
      evaluatedDecision: evaluated.decision,
      appliedDecision: decision.decision,
      score: decision.score,
      blockers: decision.blockers,
      conditions: decision.conditions,
      criteria: decision.criteria,
      overrideReason: body.overrideReason ?? null,
    },
  });

  return NextResponse.json({ success: true, decision });
}
