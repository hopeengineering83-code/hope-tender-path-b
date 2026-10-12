import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { evaluateBidDecision } from "../../../../../lib/engine/bid-decision";
import { getTenderReleaseSnapshot } from "../../../../../lib/engine/tender-release-snapshot";
import { logAction } from "../../../../../lib/audit";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

// A bid verdict must never be evaluated with confidence before the tender
// has valid source extraction and grounded AI analysis — an automatic
// evaluation from empty/ungrounded data defaults to non-blocking scores
// (see evaluateBidDecision) and would present a false BID/NO_BID verdict.
// A human MAY still record an explicit, audited override before grounding
// (matches the ≥10-character reason bar used elsewhere for critical
// audited overrides) — that is a deliberate human judgment call, not an
// automatic evaluation.
const MIN_UNGROUNDED_OVERRIDE_REASON_LENGTH = 10;

async function isReadinessCalculable(tenderId: string, userId: string): Promise<boolean> {
  const snapshot = await getTenderReleaseSnapshot(prisma, tenderId, userId).catch(() => null);
  if (!snapshot) return false;
  return snapshot.extraction.overallOk && snapshot.analysis.eligibleForExport;
}

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

  if (!(await isReadinessCalculable(id, actor.id))) {
    return NextResponse.json({
      success: true,
      decision: null,
      calculable: false,
      message: "Decision unavailable — valid source extraction and grounded AI analysis are required before a bid verdict can be calculated.",
    });
  }

  const decision = evaluateBidDecision({
    deadline: tender.deadline,
    budget: tender.budget,
    requirements: tender.requirements,
    complianceGaps: tender.complianceGaps,
    expertMatches: tender.expertMatches,
    projectMatches: tender.projectMatches,
    generatedDocuments: tender.generatedDocuments,
  });

  return NextResponse.json({ success: true, decision, calculable: true });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const rl = await rateLimitPersistent(`bid-decision:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

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

  const calculable = await isReadinessCalculable(id, actor.id);
  const overrideDecision = ["BID", "BID_WITH_CONDITIONS", "NO_BID"].includes(body.overrideDecision ?? "") ? body.overrideDecision : null;

  // An automatic evaluation must never be recorded from ungrounded data — it
  // would default to non-blocking scores (see evaluateBidDecision) and record
  // a false verdict. A human MAY still record an explicit, audited override.
  if (!calculable && !overrideDecision) {
    return NextResponse.json({
      error: "Automatic bid-decision evaluation is unavailable — valid source extraction and grounded AI analysis are required first. Provide an explicit overrideDecision with a reason to record a manual decision anyway.",
    }, { status: 409 });
  }

  const minReasonLength = calculable ? 1 : MIN_UNGROUNDED_OVERRIDE_REASON_LENGTH;
  if (overrideDecision && (body.overrideReason ?? "").trim().length < minReasonLength) {
    return NextResponse.json({
      error: calculable
        ? "Override reason is required when overriding the evaluated bid decision."
        : `Override reason must be at least ${MIN_UNGROUNDED_OVERRIDE_REASON_LENGTH} characters when recording a decision before source extraction and AI analysis are grounded.`,
    }, { status: 400 });
  }

  const evaluated = calculable
    ? evaluateBidDecision({
        deadline: tender.deadline,
        budget: tender.budget,
        requirements: tender.requirements,
        complianceGaps: tender.complianceGaps,
        expertMatches: tender.expertMatches,
        projectMatches: tender.projectMatches,
        generatedDocuments: tender.generatedDocuments,
      })
    : {
        decision: "NO_BID" as const,
        score: 0,
        criteria: [],
        blockers: [],
        conditions: [],
        summary: "Automatic evaluation unavailable — source extraction and AI analysis are not yet grounded.",
      };

  const decision = overrideDecision
    ? {
        ...evaluated,
        decision: overrideDecision as typeof evaluated.decision,
        summary: calculable
          ? `${overrideDecision.replace(/_/g, " ")} — manual override from evaluated ${evaluated.decision} at ${evaluated.score}/100. ${body.overrideReason}`
          : `${overrideDecision.replace(/_/g, " ")} — manual override recorded before source extraction and AI analysis were grounded (automatic evaluation unavailable). ${body.overrideReason}`,
      }
    : evaluated;
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
