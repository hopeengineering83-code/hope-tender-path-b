// POST /api/ai-jobs/[id]/recover
//
// Recovery endpoint for AI jobs stuck at CHUNKS_STILL_ACTIVE.
//
// CHUNKS_STILL_ACTIVE must never be a permanent final state. This endpoint
// provides four recovery actions:
//
//   • resume           — if there are QUEUED chunks, confirms the job is
//                        RUNNING so run-next can pick them up. Use when
//                        fresh RUNNING chunks exist and progress is being made.
//
//   • finalize_completed — if all chunks are terminal, triggers job
//                        finalization (promotion). Also force-terminals
//                        stale RUNNING chunks (with result → SUCCEEDED,
//                        without result → FAILED). Use when chunks are done
//                        but the job hasn't promoted.
//
//   • reset_stale      — resets stale RUNNING chunks (older than 10 min)
//                        back to QUEUED so run-next can re-claim them.
//                        Fresh RUNNING chunks are left alone. Use when
//                        chunks appear hung.
//
//   • restart          — resets ALL non-terminal chunks (FAILED/RUNNING/QUEUED)
//                        back to QUEUED and resets the job to RUNNING. Use
//                        when the job is in a bad state and needs a full restart.
//
// The endpoint is:
//   • Tenant-safe (scoped to userId — admins can recover any job, others
//     only jobs for tenders they own)
//   • RBAC-safe (requires ADMIN, PROPOSAL_MANAGER, or REVIEWER)
//   • Idempotent (running the same action twice is safe)
//   • Audited (every recovery is logged via logAction)

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import {
  diagnoseJobChunks,
  resetStaleChunks,
  finalizeCompletedChunks,
  restartJob,
  resumeAnalysis,
  type ChunkRecoveryAction,
} from "../../../../../lib/ai-jobs/chunk-recovery";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER");
  } catch (e) {
    return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  await prismaReady;
  const { id: jobId } = await params;

  // Ownership check — admins can recover any job; others must own the tender
  const job = await prisma.aiJob.findUnique({
    where: { id: jobId },
    select: { id: true, userId: true, tenderId: true },
  });
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (actor.role !== "ADMIN" && job.userId !== actor.id) {
    if (job.tenderId) {
      const ownsTender = await prisma.tender.findFirst({
        where: { id: job.tenderId, userId: actor.id },
        select: { id: true },
      });
      if (!ownsTender) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }
    } else {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
  }

  // Parse action from body
  const body = await req.json().catch(() => ({})) as { action?: string } | null;
  const requestedAction = (body?.action ?? "diagnose") as ChunkRecoveryAction | "diagnose";

  // If no action specified, just return diagnostics
  if (requestedAction === "diagnose") {
    const diagnostics = await diagnoseJobChunks(jobId, actor.id);
    if (!diagnostics) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, action: "diagnose", diagnostics });
  }

  // Validate action
  const validActions: ChunkRecoveryAction[] = ["resume", "finalize_completed", "reset_stale", "restart"];
  if (!validActions.includes(requestedAction)) {
    return NextResponse.json({
      error: `Invalid action "${requestedAction}". Must be one of: ${validActions.join(", ")}, diagnose`,
    }, { status: 400 });
  }

  // Execute the requested action
  let result;
  switch (requestedAction) {
    case "resume":
      result = await resumeAnalysis(jobId, actor.id);
      break;
    case "finalize_completed":
      result = await finalizeCompletedChunks(jobId, actor.id);
      break;
    case "reset_stale":
      result = await resetStaleChunks(jobId, actor.id);
      break;
    case "restart":
      result = await restartJob(jobId, actor.id);
      break;
    default:
      return NextResponse.json({ error: "Unhandled action" }, { status: 400 });
  }

  return NextResponse.json(result);
}

/**
 * GET /api/ai-jobs/[id]/recover
 * Returns diagnostics without performing any recovery action. Useful for
 * polling the job's chunk state to decide which action to take.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER");
  } catch (e) {
    return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  await prismaReady;
  const { id: jobId } = await params;

  const job = await prisma.aiJob.findUnique({
    where: { id: jobId },
    select: { id: true, userId: true, tenderId: true },
  });
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (actor.role !== "ADMIN" && job.userId !== actor.id) {
    if (job.tenderId) {
      const ownsTender = await prisma.tender.findFirst({
        where: { id: job.tenderId, userId: actor.id },
        select: { id: true },
      });
      if (!ownsTender) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }
    } else {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
  }

  const diagnostics = await diagnoseJobChunks(jobId, actor.id);
  if (!diagnostics) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, action: "diagnose", diagnostics });
}
