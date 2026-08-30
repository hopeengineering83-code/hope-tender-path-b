import { createHash } from "node:crypto";
import { prisma, prismaReady } from "../prisma";
import { MAX_DURABLE_STAGE_ATTEMPTS } from "../engine/stage-retry-policy";

/**
 * The AUTO_FINALIZE stage, located or created exactly once per revision.
 *
 * AUTO_FINALIZE used to be enqueued with a bare `prisma.aiJob.create`, so every
 * PROPOSAL_GENERATION success minted a brand-new row. One owner rerun of Run
 * Engine therefore left two finalize jobs for the same tender and the same
 * analysis revision, each able to build its own package — duplicate
 * reconciliation, duplicate ZIP, and two writers racing over the same
 * documents. PROPOSAL_GENERATION had a deterministic runId protecting it from
 * exactly that; its own successor had none.
 *
 * The runId below closes it. `AiJob.runId` is unique in the schema, so the
 * upsert is the database's own guarantee rather than a check-then-act that two
 * concurrent workers can both pass.
 *
 * Rows created before this existed carry `runId = null`, which is why this
 * adopts a matching orphan instead of creating a second job beside it. The
 * owner's stuck tender has exactly such a row: enqueued by the old code,
 * stranded when the dispatcher self-call was refused.
 */

export type AutoFinalizeContinuationState =
  /** A new AUTO_FINALIZE row was created; it is claimable. */
  | "NEWLY_QUEUED"
  /** An existing row was already QUEUED; it is claimable. */
  | "REUSED_QUEUED"
  /** A failed row was re-armed within the shared attempt budget; claimable. */
  | "REARMED"
  /** Finalization already succeeded for this revision. The package exists. */
  | "ALREADY_SUCCEEDED"
  /** Another worker holds the row right now. */
  | "ALREADY_RUNNING"
  /** The row exists, is not claimable, and must not be re-armed. */
  | "NOT_CLAIMABLE";

export type AutoFinalizeContinuationResult = {
  jobId: string;
  state: AutoFinalizeContinuationState;
  /** True only when a worker can actually claim this row (status = QUEUED). */
  claimable: boolean;
  reused: boolean;
};

export function autoFinalizeContinuationRunId(input: {
  tenderId: string;
  userId: string;
  analysisRevision: string;
}): string {
  const digest = createHash("sha256")
    .update(["AUTO_FINALIZE", input.tenderId, input.userId, input.analysisRevision].join(""))
    .digest("hex");
  return `pipeline:auto-finalize:${digest}`;
}

export interface AutoFinalizeContinuationRepository {
  /**
   * An AUTO_FINALIZE row for this tender+revision that predates runIds, so it
   * can be adopted rather than duplicated. Null when there is none.
   */
  findAdoptableJob(input: {
    tenderId: string;
    analysisRevision: string;
  }): Promise<{ id: string; status: string; retries: number } | null>;
  adoptJob(input: { jobId: string; runId: string }): Promise<boolean>;
  upsertJob(input: {
    runId: string;
    tenderId: string;
    userId: string;
    analysisRevision: string;
    parentJobId: string | null;
  }): Promise<{ id: string; status: string; retries: number; created: boolean }>;
  rearmJob(jobId: string, attempts: number): Promise<boolean>;
}

function parseObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const prismaRepository: AutoFinalizeContinuationRepository = {
  async findAdoptableJob({ tenderId, analysisRevision }) {
    await prismaReady;
    // Bounded scan of this tender's recent finalize jobs. The revision lives on
    // analysisInputHash for rows written by this module and inside the input
    // JSON for rows written by the code it replaces, so both are checked —
    // otherwise the old row is invisible and gets duplicated.
    const candidates = await prisma.aiJob.findMany({
      where: { tenderId, jobType: "AUTO_FINALIZE", runId: null },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, status: true, retries: true, analysisInputHash: true, input: true },
    });
    const match = candidates.find((job) =>
      job.analysisInputHash === analysisRevision
      || parseObject(job.input).analysisRevision === analysisRevision);
    return match ? { id: match.id, status: match.status, retries: match.retries } : null;
  },

  async adoptJob({ jobId, runId }) {
    // Conditional on runId still being null: if two workers adopt at once, the
    // unique index rejects the loser and this returns false for it.
    try {
      const result = await prisma.aiJob.updateMany({
        where: { id: jobId, runId: null },
        data: { runId },
      });
      return result.count === 1;
    } catch {
      return false;
    }
  },

  async upsertJob({ runId, tenderId, userId, analysisRevision, parentJobId }) {
    await prismaReady;
    const existing = await prisma.aiJob.findUnique({ where: { runId }, select: { id: true } });
    const job = await prisma.aiJob.upsert({
      where: { runId },
      create: {
        runId,
        userId,
        tenderId,
        jobType: "AUTO_FINALIZE",
        status: "QUEUED",
        analysisInputHash: analysisRevision,
        input: JSON.stringify({
          tenderId,
          analysisRevision,
          parentJobId,
          source: "post-proposal-generation",
        }),
      },
      update: {},
      select: { id: true, status: true, retries: true },
    });
    return { ...job, created: !existing };
  },

  async rearmJob(jobId, attempts) {
    if (attempts >= MAX_DURABLE_STAGE_ATTEMPTS) return false;
    const result = await prisma.aiJob.updateMany({
      where: {
        id: jobId,
        jobType: "AUTO_FINALIZE",
        status: { in: ["FAILED", "CANCELED", "PARTIAL_SUCCESS"] },
      },
      data: {
        status: "QUEUED",
        startedAt: null,
        finishedAt: null,
        errorMessage: null,
        output: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        retries: { increment: 1 },
      },
    });
    return result.count === 1;
  },
};

/**
 * Locate or create the one AUTO_FINALIZE job for this tender + revision.
 *
 * Never reports a row as claimable unless it is genuinely QUEUED — the mistake
 * that stalled the proposal stage. A SUCCEEDED row is reported as such and left
 * alone: AUTO_FINALIZE only reaches SUCCEEDED when its own readiness gate
 * passed, so re-running it to rebuild an already-reconciled package would be a
 * second authority deciding a question the first one already answered.
 */
export async function ensureAutoFinalizeContinuationJob(
  input: {
    tenderId: string;
    userId: string;
    analysisRevision: string;
    parentJobId?: string | null;
  },
  repository: AutoFinalizeContinuationRepository = prismaRepository,
): Promise<AutoFinalizeContinuationResult> {
  const runId = autoFinalizeContinuationRunId(input);

  const adoptable = await repository.findAdoptableJob({
    tenderId: input.tenderId,
    analysisRevision: input.analysisRevision,
  });
  if (adoptable) {
    const adopted = await repository.adoptJob({ jobId: adoptable.id, runId });
    if (adopted) {
      return describe({ ...adoptable, created: false }, repository, true);
    }
  }

  const job = await repository.upsertJob({
    runId,
    tenderId: input.tenderId,
    userId: input.userId,
    analysisRevision: input.analysisRevision,
    parentJobId: input.parentJobId ?? null,
  });
  return describe(job, repository, !job.created);
}

async function describe(
  job: { id: string; status: string; retries: number; created: boolean },
  repository: AutoFinalizeContinuationRepository,
  reused: boolean,
): Promise<AutoFinalizeContinuationResult> {
  // The status decides; `created` only separates a fresh row from a reused one.
  const status = String(job.status ?? "").toUpperCase();
  if (status === "QUEUED") {
    return {
      jobId: job.id,
      state: job.created ? "NEWLY_QUEUED" : "REUSED_QUEUED",
      claimable: true,
      reused: job.created ? false : reused,
    };
  }
  if (status === "SUCCEEDED") {
    return { jobId: job.id, state: "ALREADY_SUCCEEDED", claimable: false, reused };
  }
  if (status === "RUNNING") {
    return { jobId: job.id, state: "ALREADY_RUNNING", claimable: false, reused };
  }

  const rearmed = await repository.rearmJob(job.id, job.retries ?? 0);
  return rearmed
    ? { jobId: job.id, state: "REARMED", claimable: true, reused }
    : { jobId: job.id, state: "NOT_CLAIMABLE", claimable: false, reused };
}
