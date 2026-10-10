import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  continueSuccessfulEngineToProposal,
  evaluateProposalContinuation,
  proposalContinuationRunId,
  type EngineProposalContinuationRecord,
  type ProposalContinuationRepository,
} from "../lib/ai-jobs/proposal-continuation-service";
import { MAX_DURABLE_STAGE_ATTEMPTS } from "../lib/engine/stage-retry-policy";

function eligibleEngine(overrides: Partial<EngineProposalContinuationRecord> = {}): EngineProposalContinuationRecord {
  return {
    id: "engine-1",
    jobType: "ENGINE_RUN",
    status: "SUCCEEDED",
    userId: "user-1",
    tenderId: "tender-1",
    analysisInputHash: "analysis-revision-1",
    input: JSON.stringify({ autoContinue: true }),
    output: JSON.stringify({ result: { partial: false, blockers: [], nextAction: null } }),
    tenderOwnedByUser: true,
    companyId: "company-1",
    ...overrides,
  };
}

function fakeRepository(args?: {
  engine?: EngineProposalContinuationRecord | null;
  readiness?: { ok: boolean; blockerCode?: string; blockerDetail?: string };
  initialStatus?: string;
  initialRetries?: number;
  /** Treat a RUNNING row as a worker that never came back. */
  abandoned?: boolean;
}) {
  const jobs = new Map<string, { id: string; status: string; retries: number }>();
  let creates = 0;
  let rearms = 0;
  let recoveries = 0;
  const repository: ProposalContinuationRepository = {
    async loadEngine() {
      return args?.engine === undefined ? eligibleEngine() : args.engine;
    },
    async checkGenerationReadiness() {
      return args?.readiness ?? { ok: true };
    },
    async upsertProposal({ runId }) {
      const existing = jobs.get(runId);
      if (existing) return { ...existing, created: false };
      const created = {
        id: `proposal-${++creates}`,
        status: args?.initialStatus ?? "QUEUED",
        retries: args?.initialRetries ?? 0,
      };
      jobs.set(runId, created);
      return { ...created, created: true };
    },
    async recoverAbandonedProposal(jobId) {
      // The fake stands in for the shared staleness rule: a row this test put
      // in RUNNING is treated as live unless the test says otherwise, so a
      // live generation is never silently taken away from its worker.
      recoveries += 1;
      if (!args?.abandoned) return false;
      for (const [runId, job] of jobs) {
        if (job.id === jobId && job.status === "RUNNING") {
          jobs.set(runId, { ...job, status: "FAILED" });
          return true;
        }
      }
      return false;
    },
    async rearmFailedProposal(jobId, attempts) {
      rearms += 1;
      // The real repository refuses once the shared durable-stage attempt
      // budget is spent, so the fake must too — otherwise a test could prove an
      // unbounded retry loop "works".
      if (attempts >= MAX_DURABLE_STAGE_ATTEMPTS) return false;
      for (const [runId, job] of jobs) {
        if (job.id === jobId && ["FAILED", "CANCELED", "PARTIAL_SUCCESS"].includes(job.status)) {
          jobs.set(runId, { ...job, status: "QUEUED" });
          return true;
        }
      }
      return false;
    },
  };
  return {
    repository,
    get creates() { return creates; },
    get rearms() { return rearms; },
    get recoveries() { return recoveries; },
    jobs,
  };
}

describe("proposal continuation eligibility", () => {
  it("requires an auto-continued, successful, owned ENGINE_RUN bound to an analysis revision", () => {
    assert.equal(evaluateProposalContinuation(null)?.reason, "ENGINE_NOT_FOUND");
    assert.equal(evaluateProposalContinuation(eligibleEngine({ jobType: "AI_ANALYZE" }))?.reason, "NOT_ENGINE_RUN");
    assert.equal(evaluateProposalContinuation(eligibleEngine({ input: "{}" }))?.reason, "AUTO_CONTINUE_NOT_REQUESTED");
    assert.equal(evaluateProposalContinuation(eligibleEngine({ status: "FAILED" }))?.reason, "ENGINE_NOT_SUCCEEDED");
    assert.equal(evaluateProposalContinuation(eligibleEngine({ analysisInputHash: null }))?.reason, "ANALYSIS_REVISION_MISSING");
    assert.equal(evaluateProposalContinuation(eligibleEngine({ tenderOwnedByUser: false }))?.reason, "TENDER_OR_COMPANY_OWNERSHIP_INVALID");
    assert.equal(evaluateProposalContinuation(eligibleEngine({ companyId: null }))?.reason, "TENDER_OR_COMPANY_OWNERSHIP_INVALID");
    assert.equal(evaluateProposalContinuation(eligibleEngine()), null);
  });

  it("blocks missing, malformed, or ambiguous engine output", () => {
    assert.equal(evaluateProposalContinuation(eligibleEngine({ output: null }))?.reason, "ENGINE_OUTPUT_INVALID");
    assert.equal(evaluateProposalContinuation(eligibleEngine({ output: "not-json" }))?.reason, "ENGINE_OUTPUT_INVALID");
    assert.equal(evaluateProposalContinuation(eligibleEngine({ output: "{}" }))?.reason, "ENGINE_OUTPUT_INVALID");
    assert.equal(evaluateProposalContinuation(eligibleEngine({
      output: JSON.stringify({ result: { blockers: [], nextAction: null } }),
    }))?.reason, "ENGINE_OUTPUT_INVALID");
  });

  it("blocks partial or postcondition-blocked engine output", () => {
    assert.equal(evaluateProposalContinuation(eligibleEngine({
      output: JSON.stringify({ code: "ENGINE_COMPLETED_WITH_BLOCKERS", blockers: ["missing evidence"] }),
    }))?.reason, "ENGINE_COMPLETED_WITH_BLOCKERS");
    assert.equal(evaluateProposalContinuation(eligibleEngine({
      output: JSON.stringify({ result: { partial: true, blockers: [], nextAction: "REVIEW_MATCHING_INPUTS" } }),
    }))?.reason, "ENGINE_PARTIAL");
    assert.equal(evaluateProposalContinuation(eligibleEngine({
      output: JSON.stringify({ result: { partial: false, blockers: ["evidence gap"], nextAction: null } }),
    }))?.reason, "ENGINE_COMPLETED_WITH_BLOCKERS");
  });
});

describe("proposal continuation behavior", () => {
  it("queues exactly one proposal job for a ready engine revision and reuses it on retries", async () => {
    const fake = fakeRepository();
    const [first, second] = await Promise.all([
      continueSuccessfulEngineToProposal("engine-1", fake.repository),
      continueSuccessfulEngineToProposal("engine-1", fake.repository),
    ]);

    assert.equal(first.queued, true);
    assert.equal(second.queued, true);
    assert.equal(fake.creates, 1);
    assert.equal(fake.jobs.size, 1);
    assert.equal(first.queued && second.queued ? first.jobId : "", second.queued ? second.jobId : "");
    assert.deepEqual(new Set([first.queued && first.reused, second.queued && second.reused]), new Set([false, true]));
  });

  it("does not queue when the canonical generation gate is blocked", async () => {
    const fake = fakeRepository({
      readiness: {
        ok: false,
        blockerCode: "BUILD_PLAN_NOT_CONFIRMED",
        blockerDetail: "Confirm the current Build Plan before generation.",
      },
    });
    const result = await continueSuccessfulEngineToProposal("engine-1", fake.repository);
    assert.deepEqual(result, {
      queued: false,
      // The result now names the state it is in, so callers can tell a refusal
      // to start ("BLOCKED") apart from work that is already done or already
      // running. Before, every non-queued answer looked identical.
      state: "BLOCKED",
      reason: "GENERATION_NOT_READY",
      blockerCode: "BUILD_PLAN_NOT_CONFIRMED",
      blockerDetail: "Confirm the current Build Plan before generation.",
    });
    assert.equal(fake.creates, 0);
  });

  it("re-arms one failed proposal job instead of creating a duplicate", async () => {
    const fake = fakeRepository({ initialStatus: "FAILED" });
    const first = await continueSuccessfulEngineToProposal("engine-1", fake.repository);
    const second = await continueSuccessfulEngineToProposal("engine-1", fake.repository);
    assert.equal(first.queued, true);
    assert.equal(first.queued && first.state, "REARMED");
    assert.equal(second.queued, true);
    assert.equal(fake.creates, 1);
    // The second call finds the row already QUEUED and reuses it. It used to
    // re-arm again unconditionally, which incremented the attempt counter for a
    // job that had not failed a second time — spending retry budget on a
    // success path and moving a healthy job closer to "budget exhausted".
    assert.equal(second.queued && second.state, "REUSED_QUEUED");
    assert.equal(fake.rearms, 1);
    assert.equal([...fake.jobs.values()][0].status, "QUEUED");
  });

  it("refuses to re-arm past the shared durable-stage attempt budget", async () => {
    // An owner who keeps pressing Run Engine on a genuinely broken revision
    // must not get an unbounded retry loop. The bound is the same one
    // classifyStageRetry uses, not a second budget beside it.
    const fake = fakeRepository({ initialStatus: "FAILED", initialRetries: MAX_DURABLE_STAGE_ATTEMPTS });
    const result = await continueSuccessfulEngineToProposal("engine-1", fake.repository);
    assert.equal(result.queued, false);
    assert.equal(!result.queued && result.state, "NOT_CLAIMABLE");
    assert.equal(!result.queued && "reason" in result ? result.reason : "", "PROPOSAL_RETRY_BUDGET_EXHAUSTED");
    assert.equal([...fake.jobs.values()][0].status, "FAILED");
  });

  it("binds the proposal identity to company, user, tender, and analysis revision", () => {
    const base = proposalContinuationRunId({
      companyId: "company-1",
      userId: "user-1",
      tenderId: "tender-1",
      analysisRevision: "revision-1",
    });
    assert.match(base, /^pipeline:proposal:[a-f0-9]{64}$/);
    assert.notEqual(base, proposalContinuationRunId({
      companyId: "company-1",
      userId: "user-1",
      tenderId: "tender-1",
      analysisRevision: "revision-2",
    }));
  });
});

describe("worker wiring", () => {
  const source = readFileSync("app/api/ai-jobs/run-next/route.ts", "utf8");

  it("continues only a completed ENGINE_RUN and reports the generation blocker without failing the engine", () => {
    assert.match(source, /await completeJob\(claimed\.id, result\);[\s\S]*claimed\.jobType === "ENGINE_RUN"/);
    assert.match(source, /continueSuccessfulEngineToProposal\(claimed\.id\)/);
    assert.match(source, /nextJobType = "PROPOSAL_GENERATION"/);
    assert.match(source, /generationBlockerCode = continuation\.blockerCode/);
    assert.match(source, /continuationReason = "PROPOSAL_CONTINUATION_ERROR"/);
  });
});

describe("an abandoned generation does not dead-end the rerun", () => {
  it("leaves a live generation to its worker", async () => {
    // A RUNNING row that is genuinely live must be reported as busy and never
    // taken away mid-flight, however many times Run Engine is pressed.
    const fake = fakeRepository({ initialStatus: "RUNNING" });
    const result = await continueSuccessfulEngineToProposal("engine-1", fake.repository);
    assert.equal(result.queued, false);
    assert.equal(!result.queued && result.state, "ALREADY_RUNNING");
    assert.equal([...fake.jobs.values()][0].status, "RUNNING");
    assert.equal(fake.creates, 1, "no duplicate is created for a busy stage");
  });

  it("recovers a generation whose worker never came back", async () => {
    // Without this the rerun dead-ends one stage lower than the Engine gate
    // did: generation is reported busy by a worker that died hours ago, and a
    // RUNNING row can never be claimed.
    const fake = fakeRepository({ initialStatus: "RUNNING", abandoned: true });
    const result = await continueSuccessfulEngineToProposal("engine-1", fake.repository);
    assert.equal(result.queued, true, "the owner's click must produce claimable work");
    assert.equal(result.queued && result.state, "REARMED");
    assert.equal([...fake.jobs.values()][0].status, "QUEUED");
    assert.equal(fake.creates, 1, "recovery re-arms the same job, it does not mint another");
  });

  it("still stops at the shared attempt budget when recovering", async () => {
    const fake = fakeRepository({
      initialStatus: "RUNNING",
      abandoned: true,
      initialRetries: MAX_DURABLE_STAGE_ATTEMPTS,
    });
    const result = await continueSuccessfulEngineToProposal("engine-1", fake.repository);
    assert.equal(result.queued, false);
    assert.equal(!result.queued && result.state, "ALREADY_RUNNING");
  });
});
