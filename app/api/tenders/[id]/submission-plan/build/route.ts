import { logger } from "../../../../../../lib/observability";
// POST /api/tenders/[id]/submission-plan/build
//
// Thin compatibility endpoint. Calls the same canonical buildDraftBuildPlan
// service as POST /api/tenders/[id]/build-plan. Returns the same typed result
// and blocker code for the same tender condition. Creates zero GeneratedDocument
// rows. Does NOT perform route-specific extraction, analysis, heuristic,
// optional-only, virtual-plan, or derived-plan decision logic.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { buildDraftBuildPlan } from "../../../../../../lib/engine/build-plan";
import { logAction } from "../../../../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../../lib/rate-limit";
import { sanitizeError } from "../../../../../../lib/sanitize-error";

export const dynamic = "force-dynamic";
export const maxDuration = 15;
function inferPlanEnvelope(file: { exactFileName: string; documentType?: string | null }): PlanItemEnvelope {
  const label = `${file.exactFileName} ${file.documentType ?? ""}`.toLowerCase();
  if (/financial|price|commercial|boq|bill of quantities/.test(label)) return "FINANCIAL";
  if (/registration|tax|legal|bid bond|security|declaration|form|annex|certificate/.test(label)) return "ADMIN";
  return "TECHNICAL";
}


export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const rl = rateLimit(`submission-plan-build:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded. Please wait and retry.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  await prismaReady;
  const { id } = await params;

  try {
    // Call the SAME canonical typed draft service as /build-plan.
    // Failed preflight returns { ok: false, code, message, status } — NOT 404.
    // Only a genuinely missing/foreign tender returns 404.
    const beforeDocs = await prisma.generatedDocument.count({ where: { tenderId: id } });
    const draftResult = await buildDraftBuildPlan(prisma, id, actor.id);
    if (!draftResult.ok) {
      return NextResponse.json({ ok: false, error: draftResult.message, code: draftResult.code }, { status: draftResult.status });
    }
    const afterDocs = await prisma.generatedDocument.count({ where: { tenderId: id } });
    const { plan, items } = draftResult;

    // No legacy field writes — canonical authority is itemsJson, revision, status, contentHash.

    await logAction({
      userId: actor.id,
      action: "SUBMISSION_PLAN_BUILT",
      entityType: "Tender",
      entityId: id,
      description: `Submission plan built via compatibility endpoint — DRAFT revision ${plan.revision}; ${items.length} planned files; ${afterDocs - beforeDocs} GeneratedDocument rows created.`,
      metadata: { tenderId: id, created: 0, skipped: 0, total: items.length, isDerivedDraft: false, contentHash: plan.contentHash, revision: plan.revision },
    });

    return NextResponse.json({
      ok: true,
      created: 0,
      skipped: 0,
      total: items.length,
      contentHash: plan.contentHash,
      revision: plan.revision,
      status: plan.status,
      items,
      authorizesGeneration: false,
      generatedDocumentsCreated: 0,
    });
  } catch (error) {
    logger.error("[submission-plan/build] error:", { detail: error });
    return NextResponse.json({ ok: false, error: sanitizeError(error) }, { status: 500 });
  }
}
