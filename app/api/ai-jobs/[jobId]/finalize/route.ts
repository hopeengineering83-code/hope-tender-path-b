// POST /api/ai-jobs/[jobId]/finalize
//
// Finalizes an AI Analyze job after all required chunks succeed.
// Merges + deduplicates requirements, validates source grounding for
// mandatory requirements, and atomically promotes canonical requirements.
//
// Auth: ADMIN or PROPOSAL_MANAGER (tenant-scoped).
//
// Rules:
//   - Runs only after every required chunk succeeds.
//   - Never promotes partial output.
//   - Never promotes regex fallback automatically.
//   - Preserves previous canonical requirements until promotion succeeds.
//   - Failed retry cannot overwrite or hide prior success.

import { NextRequest, NextResponse } from "next/server";
import { requireRole, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { finalizeAnalyzeJob } from "../../../../../lib/ai-jobs/durable-analyze";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch { return unauthorizedResponse(); }

  await prismaReady;
  const { jobId } = await params;

  // Tenant isolation: verify the caller owns the job.
  const job = await prisma.aiJob.findUnique({
    where: { id: jobId },
    select: { userId: true, jobType: true },
  });
  if (!job || job.userId !== actor.id || job.jobType !== "AI_ANALYZE") {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const result = await finalizeAnalyzeJob(jobId);

  if (!result.ok && result.code !== "ALREADY_PROMOTED") {
    return NextResponse.json({
      ok: false,
      code: result.code,
      requirementsPromoted: result.requirementsPromoted,
      requirementsDeduplicated: result.requirementsDeduplicated,
      safeDiagnosticSummary: result.safeDiagnosticSummary,
    }, { status: 422 });
  }

  return NextResponse.json({
    ok: true,
    code: result.code,
    requirementsPromoted: result.requirementsPromoted,
    requirementsDeduplicated: result.requirementsDeduplicated,
    safeDiagnosticSummary: result.safeDiagnosticSummary,
  });
}
