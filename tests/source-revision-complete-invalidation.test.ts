import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { invalidateTenderForSourceRevision } from "../lib/engine/source-revision-invalidation";

type Call = { where?: unknown; data?: Record<string, unknown> };

function updateManyRecorder(count: number, calls: Call[]) {
  return async (args: Call) => {
    calls.push(args);
    return { count };
  };
}

describe("source revision complete invalidation", () => {
  it("cancels active AI work and removes stale reviewer authority in one transaction", async () => {
    const documentCalls: Call[] = [];
    const aiJobCalls: Call[] = [];
    const chunkCalls: Call[] = [];
    const retryCalls: Call[] = [];
    const tenderCalls: Call[] = [];

    const noOpCalls: Call[] = [];
    const tx = {
      $executeRaw: async () => 1,
      tenderRequirement: { updateMany: updateManyRecorder(1, noOpCalls) },
      tenderExpertMatch: { updateMany: updateManyRecorder(2, noOpCalls) },
      tenderProjectMatch: { updateMany: updateManyRecorder(3, noOpCalls) },
      complianceMatrix: { updateMany: updateManyRecorder(4, noOpCalls) },
      complianceGap: { updateMany: updateManyRecorder(5, noOpCalls) },
      generatedDocument: { updateMany: updateManyRecorder(6, documentCalls) },
      buildPlan: { updateMany: updateManyRecorder(7, noOpCalls) },
      exportPackage: { updateMany: updateManyRecorder(8, noOpCalls) },
      sectionEvidenceMap: { updateMany: updateManyRecorder(9, noOpCalls) },
      tenderFactsLedger: { updateMany: updateManyRecorder(10, noOpCalls) },
      aiJob: { updateMany: updateManyRecorder(11, aiJobCalls) },
      aiAnalyzeChunk: { updateMany: updateManyRecorder(12, chunkCalls) },
      aiAnalyzeRetryState: { updateMany: updateManyRecorder(13, retryCalls) },
      matchScoreBreakdown: { updateMany: updateManyRecorder(0, noOpCalls) },
      evaluatorObjection: { updateMany: updateManyRecorder(0, noOpCalls) },
      submissionPlanState: { updateMany: updateManyRecorder(0, noOpCalls) },
      tender: {
        update: async (args: Call) => {
          tenderCalls.push(args);
          return {};
        },
      },
    } as any;

    const result = await invalidateTenderForSourceRevision(
      tx,
      "tender-1",
      "SOURCE_FILE_REPLACED",
    );

    assert.equal(result.documents, 6);
    assert.equal(result.aiJobs, 11);
    assert.equal(result.aiChunks, 12);
    assert.equal(result.retryStates, 13);

    assert.deepEqual(aiJobCalls[0].where, {
      tenderId: "tender-1",
      status: { in: ["QUEUED", "RUNNING"] },
    });
    assert.equal(aiJobCalls[0].data?.status, "CANCELED");
    assert.equal(aiJobCalls[0].data?.leaseOwner, null);
    assert.equal(aiJobCalls[0].data?.leaseExpiresAt, null);
    assert.equal(aiJobCalls[0].data?.nextAttemptAt, null);

    assert.equal(chunkCalls[0].data?.status, "SKIPPED");
    assert.equal(chunkCalls[0].data?.failureCategory, "SOURCE_REVISION_CHANGED");

    assert.equal(retryCalls[0].data?.nonRetryable, true);
    assert.equal(retryCalls[0].data?.nextRetryAt, null);
    assert.equal(retryCalls[0].data?.failureCategory, "SOURCE_REVISION_CHANGED");

    assert.equal(documentCalls[0].data?.generationStatus, "SUPERSEDED");
    assert.equal(documentCalls[0].data?.reviewedBy, null);
    assert.equal(documentCalls[0].data?.reviewedAt, null);

    assert.equal(tenderCalls[0].data?.analysisExtractionStatus, "SOURCE_REVISION_CHANGED");
    assert.equal(tenderCalls[0].data?.analysisSummary, null);
  });
});
