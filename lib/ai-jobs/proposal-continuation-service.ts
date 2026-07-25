import { createHash } from "node:crypto";
import { assertTenderReadyForGenerationAndExport } from "../engine/generation-readiness-gate";
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

export type ProposalContinuationResult =
  | { queued: true; jobId: string; reused: boolean; analysisRevision: string }
  | {
      queued: false;
      reason:
        | "ENGINE_NOT_FOUND"
        | "NOT_ENGINE_RUN"
        | "AUTO_CONTINUE_NOT_REQUESTED"
        | "ENGINE_NOT_SUCCEEDED"
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
  }): Promise<{ id: string; status: string; created: boolean }>;
  rearmFailedProposal(jobId: string): Promise<void>;
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
  if (!engine) return { queued: false, reason: "ENGINE_NOT_FOUND" };
  if (engine.jobType !== "ENGINE_RUN") return { queued: false, reason: "NOT_ENGINE_RUN" };
  if (parseObject(engine.input).autoContinue !== true) {
    return { queued: false, reason: "AUTO_CONTINUE_NOT_REQUESTED" };
  }
  if (engine.status !== "SUCCEEDED") return { queued: false, reason: "ENGINE_NOT_SUCCEEDED" };
  if (!engine.analysisInputHash) return { queued: false, reason: "ANALYSIS_REVISION_MISSING" };
  if (!engine.tenderId || !engine.companyId || !engine.tenderOwnedByUser) {
    return { queued: false, reason: "TENDER_OR_COMPANY_OWNERSHIP_INVALID" };
  }

  const output = parseObject(engine.output);
  if (output.code === "ENGINE_COMPLETED_WITH_BLOCKERS" || hasBlockers(output.blockers)) {
    return { queued: false, reason: "ENGINE_COMPLETED_WITH_BLOCKERS" };
  }

  const engineResult = asRecord(output.result);
  if (engineResult.partial === true) return { queued: false, reason: "ENGINE_PARTIAL" };
  if (hasBlockers(engineResult.blockers) || typeof engineResult.nextAction === "string") {
    return { queued: false, reason: "ENGINE_COMPLETED_WITH_BLOCKERS" };
  }

  return null;
}

const prismaRepository: ProposalContinuationRepository = {
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
      select: { id: true, status: true },
    });
    return { ...job, created: !existing };
  },

  async rearmFailedProposal(jobId) {
    await prisma.aiJob.updateMany({
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
  },
};

export async function continueSuccessfulEngineToProposal(
  engineJobId: string,
  repository: ProposalContinuationRepository = prismaRepository,
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
  await repository.rearmFailedProposal(proposal.id);

  return {
    queued: true,
    jobId: proposal.id,
    reused: !proposal.created,
    analysisRevision,
  };
}
