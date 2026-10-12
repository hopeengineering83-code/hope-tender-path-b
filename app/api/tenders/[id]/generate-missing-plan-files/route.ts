// POST /api/tenders/[id]/generate-missing-plan-files
//
// Generates every planned file the confirmed Build Plan requires that the
// package does not yet contain, and fills in rows still sitting at PLANNED.
//
// The implementation lives in lib/engine/missing-plan-file-generation.ts so
// this route and the auto-finalize continuation worker run ONE implementation
// with one set of gates — previously only this route could create a missing
// planned file, so the automatic chain reported
// "package reconciliation incomplete" as a terminal blocker for work a button
// here could have done.
//
// Auth: ADMIN or PROPOSAL_MANAGER.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { MUTATION_RATE_LIMIT, rateLimit } from "../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../lib/request-id";
import { generateMissingPlanFiles } from "../../../../../lib/engine/missing-plan-file-generation";
import { getCanonicalReadinessSummary } from "../../../../../lib/canonical-tender-readiness";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const rl = rateLimit(`generate-missing-plan-files:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { success: false, ok: false, code: "RATE_LIMITED", error: "Too many missing-plan generation requests. Wait and retry.", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  await prismaReady;
  const { id } = await params;

  const result = await generateMissingPlanFiles({
    prisma,
    tenderId: id,
    userId: actor.id,
    actorLabel: actor.email,
    requestId,
  });

  const files = {
    created: result.created,
    updated: result.updated,
    convertedFromPlanned: result.convertedFromPlanned,
    plannedCreated: result.plannedCreated,
    skipped: result.skipped,
  };

  if (!result.ok) {
    return NextResponse.json({
      success: false,
      ok: false,
      code: result.code,
      error: result.error,
      nextAction: result.nextAction,
      skipped: result.skipped.length,
      files,
    }, { status: result.status });
  }

  if (result.nothingMissing) {
    return NextResponse.json({ success: true, created: 0, updated: 0, convertedFromPlanned: 0, message: "No missing planned files remain." });
  }

  // Gap 4: re-query the canonical final-export authority after the mutation.
  const canonicalReadiness = await getCanonicalReadinessSummary(prisma, actor.id, id);
  return NextResponse.json({
    success: true,
    created: result.created.length,
    updated: result.updated.length,
    convertedFromPlanned: result.convertedFromPlanned.length,
    plannedCreated: result.plannedCreated.length,
    skipped: result.skipped.length,
    files,
    warning: "Generated narrative drafts/replacement controls require validation and reviewer approval before export. Replace official originals where reviewStatus is REPLACE_WITH_ORIGINAL.",
    canonicalReadiness,
  });
}
