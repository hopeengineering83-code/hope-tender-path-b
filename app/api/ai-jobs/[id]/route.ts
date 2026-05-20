// GET /api/ai-jobs/[id]
//
// Status endpoint for the AiJob queue (G6 fix). The UI polls this route
// while a long-running AI workflow is running so the request/response
// timer of the original POST is no longer the limiting factor.
//
// Returns: { id, status, jobType, tenderId, output, errorMessage, steps }

import { NextResponse } from "next/server";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../lib/auth";
import { getJob, recoverIfStuck } from "../../../../lib/ai-jobs";
import { prisma, prismaReady } from "../../../../lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireUser(); } catch { return unauthorizedResponse(); }

  await prismaReady;
  const { id } = await params;
  // Lazy stuck-job recovery: if this job has been RUNNING for longer
  // than AI_JOB_STUCK_AFTER_MS (default 15 min), auto-fail it before
  // returning. Stops the UI's polling loop from indefinitely showing
  // "Worker status: RUNNING" / ASYNC_POLL_TIMEOUT when the worker
  // crashed silently. The recovery is idempotent — a worker that
  // finished between this read and the recovery update is not
  // clobbered (status='RUNNING' guard in the WHERE clause).
  await recoverIfStuck(id).catch(() => {
    // Never let recovery errors block status reads; the UI continues
    // to poll either way.
  });
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  // Authorisation: ADMIN sees everything; otherwise the user must own the
  // job's tender. The job model carries userId so we can also accept the
  // creator regardless of tender ownership.
  if (actor.role !== "ADMIN") {
    const ownsTender = job.tenderId
      ? !!(await prisma.tender.findFirst({ where: { id: job.tenderId, userId: actor.id }, select: { id: true } }))
      : false;
    if (!ownsTender) {
      // Fall back to userId check via getJob's outer query — we re-fetch a
      // minimal row to be safe.
      const auth = await prisma.aiJob.findFirst({ where: { id, userId: actor.id }, select: { id: true } });
      if (!auth) return forbiddenResponse();
    }
  }

  return NextResponse.json({ job });
}
