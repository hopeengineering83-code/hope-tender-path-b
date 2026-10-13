import { NextResponse } from "next/server";
import { isProviderConfigFailureCategory } from "@/lib/ai-analyze/retry-service";
import { forbiddenResponse, requireRole, unauthorizedResponse } from "../../../../../lib/auth";
import { createAnalysisJob } from "../../../../../lib/ai-jobs/analysis-job-service";
import { scheduleRequestScopedAnalyzeWorkerWake } from "../../../../../lib/ai-jobs/request-scoped-engine-worker-wake";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { AI_RATE_LIMIT, rateLimitPersistent } from "../../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
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

    // The job now exists under verified manual authority. Nudge the durable
    // worker to claim it in this same request, or nothing will: the drain cron
    // fires only from the repository default branch, so on a Preview
    // deployment an authorized AI Analyze sat QUEUED indefinitely while the
    // panel truthfully reported "AI Analyze is queued". This starts no gate —
    // the row is already created and already authorized above.
    scheduleRequestScopedAnalyzeWorkerWake(req, tenderId);

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
    if (!nonRetryable) {
      return NextResponse.json(
        { error: message, code: "AI_ANALYZE_QUEUE_FAILED" },
        { status: 500 },
      );
    }

    // The refusal now carries WHY, and the reply says the same thing the server
    // decided. The previous fixed string claimed every refusal was "a
    // non-retryable provider/configuration error" — which was wrong in both
    // directions at once. It told users whose document had changed to go and
    // fix their API keys, and it told users whose API key was wrong that the
    // situation was non-retryable when repairing the key is exactly what makes
    // it retryable again.
    //
    // Format: AI_ANALYZE_NON_RETRYABLE:<category>:<explanation>. The
    // explanation may itself contain colons, so only the first two are
    // separators.
    const withoutPrefix = message.slice("AI_ANALYZE_NON_RETRYABLE:".length);
    const separator = withoutPrefix.indexOf(":");
    const category = separator === -1 ? withoutPrefix : withoutPrefix.slice(0, separator);
    const explanation = separator === -1 ? "" : withoutPrefix.slice(separator + 1).trim();

    // A provider/configuration block is a temporary state of the environment,
    // not a property of the tender: retrying after fixing configuration is the
    // documented path, so say so and mark it retryable.
    const providerFixable =
      category === "NO_PROVIDER_AVAILABLE" || isProviderConfigFailureCategory(category);

    return NextResponse.json({
      error: explanation || "This analysis cannot be retried in its current state.",
      code: "AI_ANALYZE_NON_RETRYABLE",
      failureCategory: category,
      retryableAfterProviderFix: providerFixable,
      nextAction: providerFixable ? "FIX_AI_PROVIDER_CONFIGURATION" : "START_FRESH_ANALYSIS",
    }, { status: 422 });
  }
}
