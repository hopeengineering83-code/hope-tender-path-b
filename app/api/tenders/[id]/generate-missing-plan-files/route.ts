import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { assertTenderReadyForGenerationAndExport } from "../../../../../lib/engine/generation-readiness-gate";
import { logAction } from "../../../../../lib/audit";
import { sanitizeError } from "../../../../../lib/sanitize-error";
import { logger } from "../../../../../lib/observability";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    await prismaReady;
    const { id } = await params;

    // Rule 6: No output GeneratedDocument row may be created before eligibility.
    const gate = await assertTenderReadyForGenerationAndExport({
      prisma,
      tenderId: id,
      userId: actor.id,
      purpose: "generate"
    });

    if (!gate.ok) {
      return NextResponse.json({
        ok: false,
        errorCode: gate.blockerCode,
        error: `Generation blocked: ${gate.blockerDetail}`,
      }, { status: 422 });
    }

    // Rest of logic would go here if this route were to be fully functional.
    // For this task, we focus on the gate enforcement.
    return NextResponse.json({ ok: true, message: "Gate passed. Implementation for generation would follow." });
  } catch (err) {
    logger.error("generate-missing-plan-files failed", { error: err });
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}
