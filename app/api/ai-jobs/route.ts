// GET /api/ai-jobs
// Lists AI jobs for the authenticated user (G6 fix). Used by the
// Tender Command Center to show "your background workflows" with
// status / progress / next-action.

import { NextResponse } from "next/server";
import { requireUser, unauthorizedResponse } from "../../../lib/auth";
import { listUserJobs, type JobStatus, type JobType } from "../../../lib/ai-jobs";

export const dynamic = "force-dynamic";

const VALID_TYPES: JobType[] = ["PROPOSAL_GENERATION", "EVALUATOR_SIM", "COPILOT_DEEP_ANALYSIS", "PROFILE_FACT_EXTRACTION"];
const VALID_STATUSES: JobStatus[] = ["QUEUED", "RUNNING", "SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "CANCELED"];

export async function GET(req: Request) {
  let actor;
  try { actor = await requireUser(); } catch { return unauthorizedResponse(); }

  const { searchParams } = new URL(req.url);
  const jobTypeParam = searchParams.get("jobType");
  const statusParam = searchParams.get("status");
  const takeParam = Number(searchParams.get("take") ?? 25);

  const jobs = await listUserJobs(actor.id, {
    jobType: VALID_TYPES.includes(jobTypeParam as JobType) ? (jobTypeParam as JobType) : undefined,
    status: VALID_STATUSES.includes(statusParam as JobStatus) ? (statusParam as JobStatus) : undefined,
    take: Number.isFinite(takeParam) ? Math.max(1, Math.min(100, takeParam)) : 25,
  });

  return NextResponse.json({ jobs });
}
