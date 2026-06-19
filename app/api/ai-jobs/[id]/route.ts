import { NextResponse } from "next/server";
import { requireUser, unauthorizedResponse } from "../../../../lib/auth";
import { getJob, recoverIfStuck } from "../../../../lib/ai-jobs";
import { prisma, prismaReady } from "../../../../lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }

  await prismaReady;
  const { id } = await params;

  const accessRow = await prisma.aiJob.findUnique({
    where: { id },
    select: { id: true, userId: true, tenderId: true },
  });
  if (!accessRow) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  if (actor.role !== "ADMIN" && accessRow.userId !== actor.id) {
    const ownsTender = accessRow.tenderId
      ? await prisma.tender.findFirst({
          where: { id: accessRow.tenderId, userId: actor.id },
          select: { id: true },
        })
      : null;
    if (!ownsTender) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // Recovery mutates job state, so it must happen only after ownership has
  // been established. This prevents an authenticated user from changing a
  // different tenant's job by guessing its identifier.
  await recoverIfStuck(id).catch(() => {
    // Recovery is best-effort; a status read remains available if it fails.
  });

  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json({ job });
}
