import { NextResponse } from "next/server";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../lib/auth";
import { failStuckJobs, findStuckJobs } from "../../../../lib/ai-jobs";

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

  const result = await failStuckJobs({ limit: 100 });
  return NextResponse.json({
    recovered: result.recovered,
    ids: result.ids,
  });
}
