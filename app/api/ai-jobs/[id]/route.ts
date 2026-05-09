// GET /api/ai-jobs/[id]
//
// Status endpoint for the AiJob queue (G6 fix). The UI polls this route
// while a long-running AI workflow is running so the request/response
// timer of the original POST is no longer the limiting factor.
//
// Returns: { id, status, jobType, tenderId, output, errorMessage, steps }

import { NextResponse } from "next/server";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../lib/auth";
import { getJob } from "../../../../lib/ai-jobs";
import { prisma, prismaReady } from "../../../../lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireUser(); } catch { return unauthorizedResponse(); }

  await prismaReady;
  const { id } = await params;
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
