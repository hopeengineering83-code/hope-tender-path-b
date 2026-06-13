import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  canPromoteToCanonical,
  promoteAnalysisToCanonical,
  stageFallbackDraft,
  stagePartialResult,
} from "../lib/ai-analyze-promotion";

const payload = {
  requirements: [],
  summary: "staged summary",
  contentHash: "abc123",
  isPartial: true,
  completedChunks: 1,
  totalChunks: 2,
};

describe("AI analysis promotion durability", () => {
  it("propagates partial staging failures instead of reporting false preservation", async () => {
    const store = {
      aiJob: {
        update: async () => { throw new Error("database unavailable"); },
      },
    } as any;
    await assert.rejects(() => stagePartialResult("job-1", payload, store), /database unavailable/);
  });

  it("persists an explicit fallback draft marker", async () => {
    let data: any;
    const store = {
      aiJob: {
        update: async (args: any) => { data = args.data; return { id: "job-1" }; },
      },
    } as any;
    await stageFallbackDraft("job-1", { ...payload, isPartial: false }, store);
    const staged = JSON.parse(data.stagedMergedResult);
    assert.equal(staged.analysisSource, "FALLBACK_DRAFT");
    assert.equal(staged.summary, "staged summary");
  });

  it("fails closed when job tracking is absent", async () => {
    const store = { aiJob: {} } as any;
    assert.equal(await canPromoteToCanonical(null, "tender-1", store), false);
  });

  it("fails closed when the tracked job does not exist", async () => {
    const store = {
      aiJob: {
        findUnique: async () => null,
      },
    } as any;
    assert.equal(await canPromoteToCanonical("job-1", "tender-1", store), false);
  });

  it("propagates version-query failures instead of authorizing promotion", async () => {
    const store = {
      aiJob: {
        findUnique: async () => { throw new Error("version lookup failed"); },
      },
    } as any;
    await assert.rejects(() => canPromoteToCanonical("job-1", "tender-1", store), /version lookup failed/);
  });

  it("rejects an older run when a newer version exists", async () => {
    const store = {
      aiJob: {
        findUnique: async () => ({ analysisVersion: 10n }),
        findFirst: async () => ({ id: "job-newer" }),
      },
    } as any;
    assert.equal(await canPromoteToCanonical("job-1", "tender-1", store), false);
  });

  it("attributes promotion to the authenticated job owner", async () => {
    let update: any;
    const store = {
      aiJob: {
        findUnique: async () => ({ userId: "user-42" }),
        update: async (args: any) => { update = args; return { id: "job-1" }; },
      },
    } as any;
    await promoteAnalysisToCanonical("job-1", "run-1", store);
    assert.equal(update.data.promotedBy, "user-42");
    assert.equal(update.data.runId, "run-1");
  });

  it("propagates promotion audit failures", async () => {
    const store = {
      aiJob: {
        findUnique: async () => ({ userId: "user-42" }),
        update: async () => { throw new Error("audit write failed"); },
      },
    } as any;
    await assert.rejects(() => promoteAnalysisToCanonical("job-1", "run-1", store), /audit write failed/);
  });
});
