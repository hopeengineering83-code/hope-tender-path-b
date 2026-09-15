import { NextResponse } from "next/server";
import { requireRole, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getTenderReleaseSnapshot } from "../../../../../lib/engine/tender-release-snapshot";
import { computeEngineSourceRevision } from "../../../../../lib/engine/engine-source-revision";
import { publicJobFailureMessage } from "../../../../../lib/prisma-schema-compatibility";

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

  const [activeJob, latestJob] = currentRevisionWhere
    ? await Promise.all([
        prisma.aiJob.findFirst({
          where: {
            ...currentRevisionWhere,
            status: { in: [...ACTIVE_ENGINE_STATUSES] },
          },
          orderBy: [{ createdAt: "desc" }, { analysisVersion: "desc" }],
          select: { id: true, status: true, createdAt: true },
        }),
        prisma.aiJob.findFirst({
          where: currentRevisionWhere,
          orderBy: [{ createdAt: "desc" }, { analysisVersion: "desc" }],
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
    : [null, null];

  const engineRunning = Boolean(activeJob);
  // The latest attempt is authoritative. An older success must never mask a
  // newer current-revision failure after a deliberate re-run.
  const engineComplete = Boolean(latestJob?.status === "SUCCEEDED") && !engineRunning;
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
          ? publicJobFailureMessage(latestJob?.errorMessage, latestJob?.id.slice(0, 8) ?? "engine")
          : null;

  return NextResponse.json({
    ok: true,
    analysisCurrent,
    analysisBlocker: snapshot?.analysis.blocker ?? null,
    sourceRevision,
    engineRunning,
    engineComplete,
    engineFailed,
    // A completed Engine run is no longer a reason to refuse another one.
    // Run Engine is one of the two actions the contract reserves to the owner,
    // and the owner's reason for pressing it again is usually that the inputs
    // changed underneath it — more Company Vault evidence uploaded, a record
    // newly source-verified — none of which moves the source revision, so the
    // old result stays "current" while being out of date. Refusing here left
    // the owner with a completed run they could not redo and no way forward.
    //
    // The duplicate-work protection that matters is still enforced: an Engine
    // job that is queued or running blocks another. Re-running is deliberate,
    // authorized, and idempotent by revision; refusing it was neither.
    canRunEngine: analysisCurrent && Boolean(sourceRevision) && !engineRunning,
    blocker,
    activeJob: activeJob
      ? { id: activeJob.id, status: activeJob.status, createdAt: activeJob.createdAt.toISOString() }
      : null,
    latestJob: latestJob
      ? {
          id: latestJob.id,
          status: latestJob.status,
          errorMessage: ["FAILED", "CANCELED"].includes(latestJob.status)
            ? publicJobFailureMessage(latestJob.errorMessage, latestJob.id.slice(0, 8))
            : null,
          createdAt: latestJob.createdAt.toISOString(),
          startedAt: latestJob.startedAt?.toISOString() ?? null,
          finishedAt: latestJob.finishedAt?.toISOString() ?? null,
        }
      : null,
  });
}
