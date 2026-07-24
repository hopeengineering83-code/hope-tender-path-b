import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  continueSuccessfulAnalysis,
  engineContinuationRunId,
  evaluateEngineContinuation,
  type AnalysisContinuationRecord,
  type EngineContinuationRepository,
} from "../lib/ai-jobs/engine-continuation-service";

function analysis(overrides: Partial<AnalysisContinuationRecord> = {}): AnalysisContinuationRecord {
  return {
    id: "analysis-1",
    jobType: "AI_ANALYZE",
    status: "SUCCEEDED",
    userId: "user-1",
    tenderId: "tender-1",
    analysisInputHash: "revision-a",
    promotedAt: new Date("2026-07-24T00:00:00.000Z"),
    supersededBy: null,
    input: JSON.stringify({ autoContinue: true }),
    tenderOwnedByUser: true,
    companyId: "company-1",
    ...overrides,
  };
}

function fakeRepository(initialAnalysis = analysis()): {
  repository: EngineContinuationRepository;
  engines: Map<string, { id: string; status: string }>;
  rearmed: string[];
  setAnalysis: (value: AnalysisContinuationRecord | null) => void;
} {
  let currentAnalysis: AnalysisContinuationRecord | null = initialAnalysis;
  const engines = new Map<string, { id: string; status: string }>();
  const rearmed: string[] = [];
  let nextId = 1;

  const repository: EngineContinuationRepository = {
    async loadAnalysis() {
      return currentAnalysis;
    },
    async upsertEngine({ runId }) {
      const existing = engines.get(runId);
      if (existing) return { ...existing, created: false };
      const created = { id: `engine-${nextId++}`, status: "QUEUED" };
      engines.set(runId, created);
      return { ...created, created: true };
    },
    async rearmFailedEngine(jobId) {
      rearmed.push(jobId);
      for (const engine of engines.values()) {
        if (engine.id === jobId && ["FAILED", "CANCELED", "PARTIAL_SUCCESS"].includes(engine.status)) {
          engine.status = "QUEUED";
        }
      }
    },
  };

  return {
    repository,
    engines,
    rearmed,
    setAnalysis(value) {
      currentAnalysis = value;
    },
  };
}

describe("automatic upload-to-Engine continuation", () => {
  it("SUCCEEDED plus autoContinue queues exactly one revision-bound Engine job", async () => {
    const fake = fakeRepository();
    const result = await continueSuccessfulAnalysis("analysis-1", fake.repository);

    assert.deepEqual(result, {
      queued: true,
      jobId: "engine-1",
      reused: false,
      analysisRevision: "revision-a",
    });
    assert.equal(fake.engines.size, 1);
  });

  it("PARTIAL_SUCCESS queues no Engine job", async () => {
    const fake = fakeRepository(analysis({ status: "PARTIAL_SUCCESS" }));
    const result = await continueSuccessfulAnalysis("analysis-1", fake.repository);

    assert.deepEqual(result, { queued: false, reason: "ANALYSIS_NOT_SUCCEEDED" });
    assert.equal(fake.engines.size, 0);
  });

  it("FAILED queues no Engine job", async () => {
    const fake = fakeRepository(analysis({ status: "FAILED" }));
    const result = await continueSuccessfulAnalysis("analysis-1", fake.repository);

    assert.deepEqual(result, { queued: false, reason: "ANALYSIS_NOT_SUCCEEDED" });
    assert.equal(fake.engines.size, 0);
  });

  it("missing autoContinue queues no Engine job", async () => {
    const fake = fakeRepository(analysis({ input: JSON.stringify({ source: "manual-analysis" }) }));
    const result = await continueSuccessfulAnalysis("analysis-1", fake.repository);

    assert.deepEqual(result, { queued: false, reason: "AUTO_CONTINUE_NOT_REQUESTED" });
    assert.equal(fake.engines.size, 0);
  });

  it("an existing active Engine job is reused for the exact analysis revision", async () => {
    const current = analysis();
    const fake = fakeRepository(current);
    const runId = engineContinuationRunId({
      companyId: current.companyId!,
      tenderId: current.tenderId!,
      userId: current.userId,
      analysisRevision: current.analysisInputHash!,
    });
    fake.engines.set(runId, { id: "engine-existing", status: "RUNNING" });

    const result = await continueSuccessfulAnalysis(current.id, fake.repository);

    assert.deepEqual(result, {
      queued: true,
      jobId: "engine-existing",
      reused: true,
      analysisRevision: "revision-a",
    });
    assert.equal(fake.engines.size, 1);
  });

  it("concurrent continuation attempts still produce one Engine job", async () => {
    const fake = fakeRepository();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => continueSuccessfulAnalysis("analysis-1", fake.repository)),
    );

    assert.equal(fake.engines.size, 1);
    assert.deepEqual(new Set(results.map((result) => result.queued ? result.jobId : "blocked")), new Set(["engine-1"]));
    assert.equal(results.filter((result) => result.queued && result.reused === false).length, 1);
    assert.equal(results.filter((result) => result.queued && result.reused === true).length, 11);
  });

  it("stale, unpromoted, or cross-tenant analysis cannot continue", () => {
    assert.deepEqual(
      evaluateEngineContinuation(analysis({ supersededBy: "analysis-2" })),
      { queued: false, reason: "ANALYSIS_SUPERSEDED" },
    );
    assert.deepEqual(
      evaluateEngineContinuation(analysis({ promotedAt: null })),
      { queued: false, reason: "ANALYSIS_NOT_PROMOTED" },
    );
    assert.deepEqual(
      evaluateEngineContinuation(analysis({ tenderOwnedByUser: false })),
      { queued: false, reason: "TENDER_OR_COMPANY_OWNERSHIP_INVALID" },
    );
  });
});
