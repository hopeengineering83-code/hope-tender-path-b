import { NextResponse } from "next/server";
import { forbiddenResponse, requireRole, unauthorizedResponse } from "../../../../../lib/auth";
import { createAnalysisJob } from "../../../../../lib/ai-jobs/analysis-job-service";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { AI_RATE_LIMIT, rateLimitPersistent } from "../../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  const rate = await rateLimitPersistent(`manual-ai-analyze:${actor.id}`, AI_RATE_LIMIT);
  if (!rate.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many AI Analyze requests", code: "AI_ANALYZE_RATE_LIMITED", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  await prismaReady;
  const { id: tenderId } = await params;
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    select: { id: true },
  });
  if (!tender) {
    return NextResponse.json({ error: "Tender not found", code: "TENDER_NOT_FOUND" }, { status: 404 });
  }

  try {
    // FIX 1: Manual authority is captured HERE, at the authenticated route
    // boundary, and passed INTO createAnalysisJob() as a required argument.
    // createAnalysisJob persists manualRequested=true, source="manual-ai-analyze",
    // actorUserId, and authorizedAt ATOMICALLY in the same transaction that
    // creates the job row — no race window, no post-creation patch.
    const analysis = await createAnalysisJob({
      tenderId,
      userId: actor.id,
      manualAuthority: {
        source: "manual-ai-analyze",
        actorUserId: actor.id,
        authorizedAt: new Date().toISOString(),
      },
    });

    return NextResponse.json({
      jobId: analysis.jobId,
      status: analysis.status,
      totalChunks: analysis.totalChunks,
      statusEndpoint: `/api/ai-jobs/${analysis.jobId}`,
      nextAction: "RUN_AI_ANALYZE_WORKER",
    }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI Analyze could not be queued";
    const nonRetryable = message.startsWith("AI_ANALYZE_NON_RETRYABLE:");
    return NextResponse.json({
      error: nonRetryable
        ? "The previous analysis failed with a non-retryable provider/configuration error. Correct the provider configuration before retrying."
        : message,
      code: nonRetryable ? "AI_ANALYZE_NON_RETRYABLE" : "AI_ANALYZE_QUEUE_FAILED",
    }, { status: nonRetryable ? 422 : 500 });
  }
}
