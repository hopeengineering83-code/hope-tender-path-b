import { createHash } from "node:crypto";
import { assertTenderReadyForGenerationAndExport } from "../engine/generation-readiness-gate";
import { MAX_DURABLE_STAGE_ATTEMPTS } from "../engine/stage-retry-policy";
import { prisma, prismaReady } from "../prisma";

export type EngineProposalContinuationRecord = {
  id: string;
  jobType: string;
  status: string;
  userId: string;
  tenderId: string | null;
  analysisInputHash: string | null;
  input: string;
  output: string | null;
  tenderOwnedByUser: boolean;
  companyId: string | null;
};

/**
 * What actually happened to the PROPOSAL_GENERATION job for this revision.
 *
 * This used to be a boolean, and the boolean lied. The proposal job carries a
 * deterministic runId derived from company + tender + user + analysis
 * revision, so a repeated Run Engine against an unchanged analysis resolves to
 * the SAME row. `upsertProposal` has `update: {}`, so it returns that row
 * whatever state it is in — and the service returned `queued: true` for all of
 * them. Only a QUEUED row can be claimed (claimJobForCaller updates
 * `status = 'QUEUED'` and nothing else), so for a row that had already
 * SUCCEEDED the worker was told to go claim something unclaimable: the claim
 * loop found nothing, exited, and the HTTP wake that followed found nothing
 * either. The pipeline stopped dead with no error anywhere.
 *
 * That is exactly the owner's case. The first run generated the proposal
 * successfully and then stalled at AUTO_FINALIZE. On the rerun, generation was
 * correctly recognised as already done — and the continuation reported it as
 * freshly queued work, so nothing carried the tender forward to the stage that
 * had actually been left undone.
 *
 * Each state below says what a caller may do next, and `queued` now means only
 * one thing: a QUEUED row exists that a worker can claim.
 */
export type ProposalContinuationState =
  /** A new PROPOSAL_GENERATION row was created; it is claimable. */
  | "NEWLY_QUEUED"
  /** An existing row was already QUEUED; it is claimable. */
  | "REUSED_QUEUED"
  /** A failed row was re-armed within the shared attempt budget; claimable. */
  | "REARMED"
  /** Generation already succeeded for this revision. Advance downstream. */
  | "ALREADY_SUCCEEDED"
  /** Another worker holds the row right now. Do not claim, do not duplicate. */
  | "ALREADY_RUNNING"
  /** The row exists, is not claimable, and must not be re-armed. */
  | "NOT_CLAIMABLE"
  /** No proposal row was reached at all: the engine or the gate refused. */
  | "BLOCKED";

export type ProposalContinuationResult =
  | {
      queued: true;
      state: "NEWLY_QUEUED" | "REUSED_QUEUED" | "REARMED";
      jobId: string;
      reused: boolean;
      analysisRevision: string;
    }
  | {
      queued: false;
      state: "ALREADY_SUCCEEDED";
      reason: "PROPOSAL_ALREADY_SUCCEEDED";
      jobId: string;
      analysisRevision: string;
      /** Generation is done; this is the stage that still has to run. */
      advanceTo: "AUTO_FINALIZE";
    }
  | {
      queued: false;
      state: "ALREADY_RUNNING" | "NOT_CLAIMABLE";
      reason: "PROPOSAL_ALREADY_RUNNING" | "PROPOSAL_RETRY_BUDGET_EXHAUSTED";
      jobId: string;
      analysisRevision: string;
    }
  | {
      queued: false;
      state: "BLOCKED";
      reason:
        | "ENGINE_NOT_FOUND"
        | "NOT_ENGINE_RUN"
        | "AUTO_CONTINUE_NOT_REQUESTED"
        | "ENGINE_NOT_SUCCEEDED"
        | "ENGINE_OUTPUT_INVALID"
        | "ENGINE_PARTIAL"
        | "ENGINE_COMPLETED_WITH_BLOCKERS"
        | "ANALYSIS_REVISION_MISSING"
        | "TENDER_OR_COMPANY_OWNERSHIP_INVALID"
        | "GENERATION_NOT_READY";
      blockerCode?: string;
      blockerDetail?: string;
    };

export interface ProposalContinuationRepository {
  loadEngine(engineJobId: string): Promise<EngineProposalContinuationRecord | null>;
  checkGenerationReadiness(input: {
    tenderId: string;
    userId: string;
  }): Promise<{ ok: boolean; blockerCode?: string; blockerDetail?: string }>;
  upsertProposal(input: {
    runId: string;
    engine: EngineProposalContinuationRecord;
    analysisRevision: string;
  }): Promise<{ id: string; status: string; created: boolean; retries?: number }>;
  /**
   * Re-arm a failed proposal row, bounded by the shared durable-stage attempt
   * budget. Returns whether the row is claimable afterwards, so the caller
   * never has to assume a re-arm it did not observe.
   */
  rearmFailedProposal(jobId: string, attempts: number): Promise<boolean>;
  /**
   * Close a RUNNING row whose worker never came back, using the shared
   * staleness rule. Returns whether it was closed; a live run returns false and
   * is left strictly alone.
   */
  recoverAbandonedProposal(jobId: string): Promise<boolean>;
}

function parseObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hasBlockers(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

export function proposalContinuationRunId(input: {
  companyId: string;
  tenderId: string;
  userId: string;
  analysisRevision: string;
}): string {
  const digest = createHash("sha256")
    .update([
      "PROPOSAL_GENERATION",
      input.companyId,
      input.tenderId,
      input.userId,
      input.analysisRevision,
    ].join("\u001f"))
    .digest("hex");
  return `pipeline:proposal:${digest}`;
}

export function evaluateProposalContinuation(
  engine: EngineProposalContinuationRecord | null,
): Exclude<ProposalContinuationResult, { queued: true }> | null {
  if (!engine) return { queued: false, state: "BLOCKED", reason: "ENGINE_NOT_FOUND" };
  if (engine.jobType !== "ENGINE_RUN") return { queued: false, state: "BLOCKED", reason: "NOT_ENGINE_RUN" };
  if (parseObject(engine.input).autoContinue !== true) {
    return { queued: false, state: "BLOCKED", reason: "AUTO_CONTINUE_NOT_REQUESTED" };
  }
  if (engine.status !== "SUCCEEDED") return { queued: false, state: "BLOCKED", reason: "ENGINE_NOT_SUCCEEDED" };
  if (!engine.analysisInputHash) return { queued: false, state: "BLOCKED", reason: "ANALYSIS_REVISION_MISSING" };
  if (!engine.tenderId || !engine.companyId || !engine.tenderOwnedByUser) {
    return { queued: false, state: "BLOCKED", reason: "TENDER_OR_COMPANY_OWNERSHIP_INVALID" };
  }

  const output = parseObject(engine.output);
  if (output.code === "ENGINE_COMPLETED_WITH_BLOCKERS" || hasBlockers(output.blockers)) {
    return { queued: false, state: "BLOCKED", reason: "ENGINE_COMPLETED_WITH_BLOCKERS" };
  }

  if (!("result" in output)) return { queued: false, state: "BLOCKED", reason: "ENGINE_OUTPUT_INVALID" };
  const engineResult = asRecord(output.result);
  if (engineResult.partial === true) return { queued: false, state: "BLOCKED", reason: "ENGINE_PARTIAL" };
  if (engineResult.partial !== false) return { queued: false, state: "BLOCKED", reason: "ENGINE_OUTPUT_INVALID" };
  if (hasBlockers(engineResult.blockers) || typeof engineResult.nextAction === "string") {
    return { queued: false, state: "BLOCKED", reason: "ENGINE_COMPLETED_WITH_BLOCKERS" };
  }

  return null;
}

/**
 * The real repository, exported so a database test can exercise the genuine
 * upsert/re-arm behaviour against real rows while substituting only the
 * generation-readiness gate (whose own suites cover it separately).
 */
export const prismaProposalContinuationRepository: ProposalContinuationRepository = {
  async loadEngine(engineJobId) {
    await prismaReady;
    const engine = await prisma.aiJob.findUnique({
      where: { id: engineJobId },
      select: {
        id: true,
        jobType: true,
        status: true,
        userId: true,
        tenderId: true,
        analysisInputHash: true,
        input: true,
        output: true,
        tender: { select: { userId: true } },
      },
    });
    if (!engine) return null;
    const company = await prisma.company.findUnique({
      where: { userId: engine.userId },
      select: { id: true },
    });
    return {
      id: engine.id,
      jobType: engine.jobType,
      status: engine.status,
      userId: engine.userId,
      tenderId: engine.tenderId,
      analysisInputHash: engine.analysisInputHash,
      input: engine.input,
      output: engine.output,
      tenderOwnedByUser: Boolean(engine.tender && engine.tender.userId === engine.userId),
      companyId: company?.id ?? null,
    };
  },

  async checkGenerationReadiness({ tenderId, userId }) {
    return assertTenderReadyForGenerationAndExport({
      prisma,
      tenderId,
      userId,
      purpose: "background-proposal-generation",
    });
  },

  async upsertProposal({ runId, engine, analysisRevision }) {
    if (!engine.tenderId || !engine.companyId) {
      throw new Error("PROPOSAL_CONTINUATION_OWNERSHIP_NOT_RESOLVED");
    }
    const existing = await prisma.aiJob.findUnique({
      where: { runId },
      select: { id: true },
    });
    const job = await prisma.aiJob.upsert({
      where: { runId },
      create: {
        runId,
        userId: engine.userId,
        tenderId: engine.tenderId,
        jobType: "PROPOSAL_GENERATION",
        status: "QUEUED",
        analysisInputHash: analysisRevision,
        input: JSON.stringify({
          source: "canonical-engine-success",
          autoContinue: true,
          parentJobId: engine.id,
          companyId: engine.companyId,
          analysisRevision,
        }),
      },
      update: {},
      select: { id: true, status: true, retries: true },
    });
    return { ...job, created: !existing };
  },

  async recoverAbandonedProposal(jobId) {
    const { recoverIfStuck } = await import("../ai-jobs");
    return recoverIfStuck(jobId).catch(() => false);
  },

  async rearmFailedProposal(jobId, attempts) {
    if (attempts >= MAX_DURABLE_STAGE_ATTEMPTS) return false;
    const result = await prisma.aiJob.updateMany({
      where: {
        id: jobId,
        jobType: "PROPOSAL_GENERATION",
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

export async function continueSuccessfulEngineToProposal(
  engineJobId: string,
  repository: ProposalContinuationRepository = prismaProposalContinuationRepository,
): Promise<ProposalContinuationResult> {
  const engine = await repository.loadEngine(engineJobId);
  const blocked = evaluateProposalContinuation(engine);
  if (blocked) return blocked;

  const eligible = engine!;
  const readiness = await repository.checkGenerationReadiness({
    tenderId: eligible.tenderId!,
    userId: eligible.userId,
  });
  if (!readiness.ok) {
    return {
      queued: false,
      state: "BLOCKED",
      reason: "GENERATION_NOT_READY",
      blockerCode: readiness.blockerCode,
      blockerDetail: readiness.blockerDetail,
    };
  }

  const analysisRevision = eligible.analysisInputHash!;
  const runId = proposalContinuationRunId({
    companyId: eligible.companyId!,
    tenderId: eligible.tenderId!,
    userId: eligible.userId,
    analysisRevision,
  });
  const proposal = await repository.upsertProposal({ runId, engine: eligible, analysisRevision });

  // Report the row's ACTUAL state. `queued: true` promises the caller a row it
  // can claim, and only a QUEUED row is claimable.
  //
  // The status decides, not the fact that a row was just created — "created"
  // only distinguishes a fresh row from a reused one. Deciding on `created`
  // first would repeat the original mistake in miniature: reporting a state
  // from how the row was reached rather than from what the row says.
  const status = String(proposal.status ?? "").toUpperCase();

  if (status === "QUEUED") {
    return {
      queued: true,
      state: proposal.created ? "NEWLY_QUEUED" : "REUSED_QUEUED",
      jobId: proposal.id,
      reused: !proposal.created,
      analysisRevision,
    };
  }

  if (status === "SUCCEEDED") {
    // Generation is done for this exact revision. Re-running it would produce a
    // duplicate proposal version, a duplicate set of expert CVs and duplicate
    // documents, purely to manufacture something claimable — the pipeline does
    // not need generation repeated, it needs the stage after it.
    return {
      queued: false,
      state: "ALREADY_SUCCEEDED",
      reason: "PROPOSAL_ALREADY_SUCCEEDED",
      jobId: proposal.id,
      analysisRevision,
      advanceTo: "AUTO_FINALIZE",
    };
  }

  if (status === "RUNNING") {
    // Another worker may hold it — or a worker killed mid-invocation left it
    // RUNNING forever, in which case nothing can ever claim it again and the
    // rerun dead-ends here instead of at the stage below.
    //
    // The shared staleness rule decides which it is, so a live generation is
    // never interrupted. A closed one becomes FAILED and is re-armed within
    // the same bounded budget as any other failure.
    const recovered = await repository.recoverAbandonedProposal(proposal.id);
    const rearmed = recovered
      ? await repository.rearmFailedProposal(proposal.id, proposal.retries ?? 0)
      : false;
    if (rearmed) {
      return { queued: true, state: "REARMED", jobId: proposal.id, reused: true, analysisRevision };
    }
    return {
      queued: false,
      state: "ALREADY_RUNNING",
      reason: "PROPOSAL_ALREADY_RUNNING",
      jobId: proposal.id,
      analysisRevision,
    };
  }

  // FAILED / CANCELED / PARTIAL_SUCCESS — re-arm within the shared budget.
  const rearmed = await repository.rearmFailedProposal(proposal.id, proposal.retries ?? 0);
  if (rearmed) {
    return { queued: true, state: "REARMED", jobId: proposal.id, reused: true, analysisRevision };
  }

  return {
    queued: false,
    state: "NOT_CLAIMABLE",
    reason: "PROPOSAL_RETRY_BUDGET_EXHAUSTED",
    jobId: proposal.id,
    analysisRevision,
  };
}
