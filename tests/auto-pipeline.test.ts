import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  decideTenderUploadAutoPipeline,
  triggerTenderUploadAutoPipeline,
  type UploadFirstResponse,
} from "../lib/ui/auto-pipeline";

describe("server-owned tender pipeline", () => {
  it("wakes the worker only for a durable server-created job", () => {
    const response: UploadFirstResponse = {
      success: true,
      tenderId: "tender-abc",
      engineSkipped: true,
      nextAction: "RUN_AI_ANALYZE",
    };
    assert.equal(decideTenderUploadAutoPipeline(response), null);
    assert.equal(decideTenderUploadAutoPipeline({
      ...response,
      processingJobId: "job-123",
      pipelineStage: "EXTRACT_TEXT_QUEUED",
    }), "/api/ai-jobs/run-next?jobType=EXTRACT_TEXT");
    assert.equal(decideTenderUploadAutoPipeline({
      ...response,
      processingJobId: "job-456",
      pipelineStage: "AI_ANALYZE_QUEUED",
    }), "/api/ai-jobs/run-next?jobType=AI_ANALYZE");
    assert.equal(decideTenderUploadAutoPipeline({
      ...response,
      processingJobId: "job-without-authority",
    }), null);
  });

  it("does not call any worker when the server did not create a job", async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error("worker fetch must not run");
    }) as typeof fetch;
    try {
      const result = await triggerTenderUploadAutoPipeline({
        success: true,
        tenderId: "tender-abc",
        engineSkipped: true,
        nextAction: "RUN_AI_ANALYZE",
      });
      assert.equal(calls, 0);
      assert.equal(result.fired, false);
      assert.equal(result.endpoint, null);
      assert.equal(result.status, "skipped");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("immediately wakes the worker for a server-created processing job", async () => {
    const originalFetch = globalThis.fetch;
    let endpoint = "";
    globalThis.fetch = (async (input) => {
      endpoint = String(input);
      return new Response(JSON.stringify({ ran: 1 }), { status: 200 });
    }) as typeof fetch;
    try {
      const result = await triggerTenderUploadAutoPipeline({
        success: true,
        tenderId: "tender-abc",
        processingJobId: "job-123",
        pipelineStage: "EXTRACT_TEXT_QUEUED",
      });
      assert.equal(endpoint, "/api/ai-jobs/run-next?jobType=EXTRACT_TEXT");
      assert.equal(result.fired, true);
      assert.equal(result.endpoint, endpoint);
      assert.equal(result.status, "queued");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves the upload response contract", () => {
    const response: UploadFirstResponse = {
      success: true,
      tenderId: "t-1",
      engineSkipped: true,
      nextAction: "RUN_AI_ANALYZE",
      processingJobId: "job-1",
      pipelineStage: "EXTRACT_TEXT_QUEUED",
      requestId: "req-1",
    };
    assert.equal(response.engineSkipped, true);
    assert.equal(response.nextAction, "RUN_AI_ANALYZE");
    assert.equal(response.processingJobId, "job-1");
    assert.equal(response.pipelineStage, "EXTRACT_TEXT_QUEUED");
  });
});
