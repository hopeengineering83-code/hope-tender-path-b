// GET /api/ai-jobs
// Lists AI jobs for the authenticated user (G6 fix). Used by the
// Tender Command Center to show "your background workflows" with
// status / progress / next-action.

import { NextResponse } from "next/server";
import { requireUser, unauthorizedResponse } from "../../../lib/auth";
import { listUserJobs, type JobStatus } from "../../../lib/ai-jobs";
import { parseJobTypeFilter, SUPPORTED_JOB_TYPES } from "../../../lib/job-type-policy";

export const dynamic = "force-dynamic";

const VALID_STATUSES: JobStatus[] = ["QUEUED", "RUNNING", "SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "CANCELED"];

export async function GET(req: Request) {
  let actor;
  try { actor = await requireUser(); } catch { return unauthorizedResponse(); }

  const { searchParams } = new URL(req.url);
  const parsedJobType = parseJobTypeFilter(searchParams.get("jobType"));
  if (!parsedJobType.ok) {
    return NextResponse.json({
      error: "Invalid jobType filter",
      code: parsedJobType.code,
      supportedJobTypes: SUPPORTED_JOB_TYPES,
    }, { status: 400 });
  }

  const statusParam = searchParams.get("status");
  const tenderId = searchParams.get("tenderId")?.trim() || undefined;
  const takeParam = Number(searchParams.get("take") ?? 25);

  const jobs = await listUserJobs(actor.id, {
    jobType: parsedJobType.value,
    status: VALID_STATUSES.includes(statusParam as JobStatus) ? (statusParam as JobStatus) : undefined,
    tenderId,
    take: Number.isFinite(takeParam) ? Math.max(1, Math.min(100, takeParam)) : 25,
  });

  return NextResponse.json({ jobs });
}
