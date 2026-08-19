import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  EXTRACT_TEXT_WORKER_ENDPOINT,
  VAULT_INGEST_WORKER_ENDPOINT,
  decideTenderUploadAutoPipeline,
  startQueuedVaultIngestion,
  triggerTenderUploadAutoPipeline,
  type UploadFirstResponse,
} from "../lib/ui/auto-pipeline";

describe("manual AI Analyze / manual Run Engine workflow", () => {
  it("wakes ONLY the EXTRACT_TEXT worker after upload — never AI_ANALYZE", () => {
    const response: UploadFirstResponse = {
      success: true,
      tenderId: "tender-abc",
      nextAction: "WAIT_FOR_SOURCE_EXTRACTION",
    };
    // No processingJobId → no auto-nudge.
    assert.equal(decideTenderUploadAutoPipeline(response), null);
    // EXTRACT_TEXT_QUEUED → nudge EXTRACT_TEXT worker only.
    assert.equal(
      decideTenderUploadAutoPipeline({
        ...response,
        processingJobId: "job-123",
        pipelineStage: "EXTRACT_TEXT_QUEUED",
      }),
      EXTRACT_TEXT_WORKER_ENDPOINT,
    );
    // No pipelineStage → no nudge.
    assert.equal(
      decideTenderUploadAutoPipeline({
        ...response,
        processingJobId: "job-without-authority",
      }),
      null,
    );
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
        nextAction: "WAIT_FOR_SOURCE_EXTRACTION",
      });
      assert.equal(calls, 0);
      assert.equal(result.fired, false);
      assert.equal(result.endpoint, null);
      assert.equal(result.status, "skipped");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("wakes ONLY the EXTRACT_TEXT worker — never nudges AI_ANALYZE", async () => {
    const originalFetch = globalThis.fetch;
    const endpoints: string[] = [];
    globalThis.fetch = (async (input) => {
      endpoints.push(String(input));
      return new Response(JSON.stringify({ ran: 1 }), { status: 200 });
    }) as typeof fetch;
    try {
      const result = await triggerTenderUploadAutoPipeline({
        success: true,
        tenderId: "tender-abc",
        processingJobId: "job-123",
        pipelineStage: "EXTRACT_TEXT_QUEUED",
      });
      // ONLY EXTRACT_TEXT_WORKER_ENDPOINT — NOT AI_ANALYZE_WORKER_ENDPOINT.
      assert.deepEqual(endpoints, [EXTRACT_TEXT_WORKER_ENDPOINT]);
      assert.equal(result.fired, true);
      assert.equal(result.endpoint, EXTRACT_TEXT_WORKER_ENDPOINT);
      assert.equal(result.status, "queued");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("the message tells the user to click Run AI Analyze after extraction", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ ran: 1 }), { status: 200 })) as typeof fetch;
    try {
      const result = await triggerTenderUploadAutoPipeline({
        success: true,
        tenderId: "tender-abc",
        processingJobId: "job-123",
        pipelineStage: "EXTRACT_TEXT_QUEUED",
      });
      assert.match(result.message, /Run AI Analyze/i);
      assert.match(result.message, /Run Engine/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("starts queued vault ingestion", async () => {
    const originalFetch = globalThis.fetch;
    const endpoints: string[] = [];
    globalThis.fetch = (async (input) => {
      endpoints.push(String(input));
      return new Response(JSON.stringify({ ran: 1 }), { status: 200 });
    }) as typeof fetch;
    try {
      await startQueuedVaultIngestion();
      assert.deepEqual(endpoints, [VAULT_INGEST_WORKER_ENDPOINT]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
