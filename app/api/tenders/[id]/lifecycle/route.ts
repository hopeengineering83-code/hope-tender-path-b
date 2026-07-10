import { logger } from "../../../../../lib/observability";
import { NextRequest, NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";
import { computeTenderLifecycle } from "../../../../../lib/engine/tender-lifecycle-orchestrator";
import { safeApiError, newDiagnosticId } from "../../../../../lib/engine/safe-api-error";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    const { id: tenderId } = await params;

    const result = await computeTenderLifecycle(prisma, tenderId, actor.id);

    if (!result) {
      // 404 is NOT an error condition — it's a legitimate "not found"
      // response. But we still include a diagnosticId so the user can
      // reference it in support requests if they believe the tender
      // should exist.
      return NextResponse.json(
        { ok: false, error: "Tender not found", code: "TENDER_NOT_FOUND", diagnosticId: newDiagnosticId("lifecycle") },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    // Per spec rule 9: never return raw error.message. Use safeApiError to
    // log the raw error server-side (keyed by diagnosticId) and return a
    // safe user-facing message + diagnosticId to the API consumer. This
    // keeps the Recovery Command Center from leaking Prisma errors, SQL,
    // user IDs, tender IDs, or stack traces to the browser.
    logger.error("[lifecycle] route failed", { detail: error });
    return safeApiError("lifecycle", error, {
      status: 500,
      message: "Lifecycle computation failed. Refresh to retry. If the problem persists, file a support request with the Diagnostic ID.",
    });
  }
}
