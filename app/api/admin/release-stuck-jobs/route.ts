import { logger } from "../../../../lib/observability";
import { NextResponse } from "next/server";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../lib/auth";
import { failStuckJobs, findStuckJobs } from "../../../../lib/ai-jobs";
import { logAction } from "../../../../lib/audit";
import { rateLimit } from "../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Stuck-job recovery admin endpoint.
 *
 * GET — preview: lists jobs that have been RUNNING longer than the
 *   stuck threshold without modifying them. Useful for operators to
 *   see "is something stuck?" before deciding to release.
 *
 * POST — recovery: marks every stuck job as FAILED with a clear
 *   error message and an "auto-failed by stuck-job recovery" tag.
 *   Idempotent: a worker that finished between detection and
 *   recovery is NOT clobbered.
 *
 * Auth: ADMIN only. Stuck-job recovery is a maintenance operation
 * that surfaces and resolves background-worker failures across
 * users' tenders.
 */
export async function GET() {
  let actor;
  try { actor = await requireUser(); } catch { return unauthorizedResponse(); }
  if (actor.role !== "ADMIN") return forbiddenResponse();

  const result = await findStuckJobs({ limit: 100 });
  return NextResponse.json({
    stuckCount: result.count,
    jobs: result.jobs.map((j) => ({
      id: j.id,
      jobType: j.jobType,
      userId: j.userId,
      tenderId: j.tenderId,
      startedAt: j.startedAt,
      stuckForMs: j.startedAt ? Date.now() - j.startedAt.getTime() : null,
    })),
  });
}

export async function POST() {
  let actor;
  try { actor = await requireUser(); } catch { return unauthorizedResponse(); }
  if (actor.role !== "ADMIN") return forbiddenResponse();

  // Rate limit admin stuck-job recovery: max 10 per minute per admin
  const rl = rateLimit(`admin-release-stuck-jobs:${actor.id}`, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limited. Too many recovery requests. Please wait.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  const result = await failStuckJobs({ limit: 100 });

  // Audit log the recovery operation
  await logAction({
    userId: actor.id,
    action: "ADMIN_RELEASE_STUCK_JOBS",
    description: `Released ${result.recovered} stuck job(s) via admin recovery`,
    metadata: {
      jobsRecovered: result.recovered,
      jobIds: result.ids.slice(0, 10), // Log first 10 IDs
      totalIds: result.ids.length,
    },
  }).catch((err) => logger.warn("Failed to log stuck-job recovery action:", { detail: err }));

  return NextResponse.json({
    recovered: result.recovered,
    ids: result.ids,
  });
}
