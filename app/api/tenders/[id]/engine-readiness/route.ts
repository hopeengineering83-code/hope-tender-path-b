import { NextResponse } from "next/server";
import { requireRole, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getTenderReleaseSnapshot } from "../../../../../lib/engine/tender-release-snapshot";
import { computeEngineSourceRevision } from "../../../../../lib/engine/engine-source-revision";

export const dynamic = "force-dynamic";

const ACTIVE_ENGINE_STATUSES = ["QUEUED", "RUNNING", "PARTIAL_SUCCESS"] as const;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER").catch(() => null);
  if (!actor) return unauthorizedResponse();

  await prismaReady;
  const { id: tenderId } = await params;

  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    select: { id: true },
  });
  if (!tender) {
    return NextResponse.json(
      { error: "Tender not found", code: "TENDER_NOT_FOUND", terminal: true },
      { status: 404 },
    );
  }

  const [snapshot, company] = await Promise.all([
    getTenderReleaseSnapshot(prisma, tenderId, actor.id).catch(() => null),
    prisma.company.findUnique({
      where: { userId: actor.id },
      select: { id: true },
    }),
  ]);

  const analysisCurrent = Boolean(
    snapshot?.analysis.state === "AI_SUCCEEDED"
      && snapshot.analysis.contentHashMatch
      && snapshot.analysis.canonicalJobId,
  );

  const revision = company
    ? await computeEngineSourceRevision(prisma, {
        tenderId,
        userId: actor.id,
        companyId: company.id,
      }).catch(() => null)
    : null;

  const sourceRevision = revision?.sourceRevision ?? null;
  const currentRevisionWhere = sourceRevision
    ? {
        tenderId,
        userId: actor.id,
        jobType: "ENGINE_RUN",
        analysisInputHash: sourceRevision,
      }
    : null;

  const [activeJob, succeededJob, latestJob] = currentRevisionWhere
    ? await Promise.all([
        prisma.aiJob.findFirst({
          where: {
            ...currentRevisionWhere,
            status: { in: [...ACTIVE_ENGINE_STATUSES] },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, status: true, createdAt: true },
        }),
        prisma.aiJob.findFirst({
          where: { ...currentRevisionWhere, status: "SUCCEEDED" },
          orderBy: { finishedAt: "desc" },
          select: { id: true, status: true, finishedAt: true },
        }),
        prisma.aiJob.findFirst({
          where: currentRevisionWhere,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            status: true,
            errorMessage: true,
            createdAt: true,
            startedAt: true,
            finishedAt: true,
          },
        }),
      ])
    : [null, null, null];

  const engineRunning = Boolean(activeJob);
  const engineComplete = Boolean(succeededJob) && !engineRunning;
  const engineFailed = Boolean(
    latestJob
      && ["FAILED", "CANCELED"].includes(latestJob.status)
      && !engineRunning
      && !engineComplete,
  );

  const blocker = !analysisCurrent
    ? snapshot?.analysis.blocker ?? "Run AI Analyze successfully for the current canonical source revision."
    : !company
      ? "Create the Company Vault before running Engine."
      : !sourceRevision
        ? "The current Engine source revision could not be established."
        : engineFailed
          ? latestJob?.errorMessage?.slice(0, 500) || "The latest Engine job failed. Correct the reported issue and retry."
          : null;

  return NextResponse.json({
    ok: true,
    analysisCurrent,
    analysisBlocker: snapshot?.analysis.blocker ?? null,
    sourceRevision,
    engineRunning,
    engineComplete,
    engineFailed,
    canRunEngine: analysisCurrent && Boolean(sourceRevision) && !engineRunning && !engineComplete,
    blocker,
    activeJob: activeJob
      ? { id: activeJob.id, status: activeJob.status, createdAt: activeJob.createdAt.toISOString() }
      : null,
    latestJob: latestJob
      ? {
          id: latestJob.id,
          status: latestJob.status,
          errorMessage: latestJob.errorMessage?.slice(0, 500) ?? null,
          createdAt: latestJob.createdAt.toISOString(),
          startedAt: latestJob.startedAt?.toISOString() ?? null,
          finishedAt: latestJob.finishedAt?.toISOString() ?? null,
        }
      : null,
  });
}
