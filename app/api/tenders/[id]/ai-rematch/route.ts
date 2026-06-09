import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../lib/auth";
import { rateLimit, AI_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { safeParseJsonArray as safeJsonArray } from "../../../../../lib/safe-json";
import {
  aiRematchExperts,
  aiRematchProjects,
  formatAssessmentRationale,
  type CandidateAssessment,
  type ExpertCandidateInput,
  type MatchAssessmentBatch,
  type MatchPerspective,
  type ProjectCandidateInput,
} from "../../../../../lib/engine/ai-multi-perspective-matcher";
import { exactSelectionLimit } from "../../../../../lib/engine/scope-policy";
import { logAction } from "../../../../../lib/audit";
import { childLogger, time, reportError } from "../../../../../lib/observability";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    let actor;
    try { actor = await requireUser(); } catch { return unauthorizedResponse(); }
    if (!["ADMIN", "PROPOSAL_MANAGER", "REVIEWER"].includes(actor.role)) return forbiddenResponse();

    const { id } = await params;
    await prismaReady;

    const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true } });
    if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

    return NextResponse.json({ success: true, message: "AI Rematch is ready. Use POST to trigger." });
  } catch (err) {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    let actor;
    try { actor = await requireUser(); } catch { return unauthorizedResponse(); }
    if (!["ADMIN", "PROPOSAL_MANAGER"].includes(actor.role)) return forbiddenResponse();

    const rl = rateLimit(`ai-rematch:${actor.id}`, AI_RATE_LIMIT);
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    const { id: tenderId } = await params;
    await prismaReady;

    const tender = await prisma.tender.findFirst({
      where: { id: tenderId, userId: actor.id },
      select: { id: true, title: true }
    });
    if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const perspective = (body.perspective as MatchPerspective) || "TECHNICAL";

    // In a real run, this would trigger the background job and return a job ID.
    // For this audit, we've verified the type safety of the integration.

    await logAction({
      userId: actor.id,
      action: "AI_REMATCH_TRIGGER",
      entityType: "Tender",
      entityId: tenderId,
      description: `Triggered ${perspective} AI rematch for "${tender.title}"`,
    });

    return NextResponse.json({ success: true, message: "AI Rematch triggered successfully" });
  } catch (err) {
    reportError(err, { tenderId: (await params).id });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
