import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  AI_ANALYZE_WORKER_ENDPOINT,
  EXTRACT_TEXT_WORKER_ENDPOINT,
  VAULT_INGEST_WORKER_ENDPOINT,
  decideTenderUploadAutoPipeline,
  startQueuedVaultIngestion,
  triggerTenderUploadAutoPipeline,
  type UploadFirstResponse,
} from "../lib/ui/auto-pipeline";

describe("server-owned tender pipeline", () => {
  it("wakes only durable server-created stages", () => {
    const response: UploadFirstResponse = {
      success: true,
      tenderId: "tender-abc",
      nextAction: "WAIT_FOR_SOURCE_EXTRACTION",
    };
    assert.equal(decideTenderUploadAutoPipeline(response), null);
    assert.equal(decideTenderUploadAutoPipeline({
      ...response,
      processingJobId: "job-123",
      pipelineStage: "EXTRACT_TEXT_QUEUED",
    }), EXTRACT_TEXT_WORKER_ENDPOINT);
    assert.equal(decideTenderUploadAutoPipeline({
      ...response,
      processingJobId: "job-456",
      pipelineStage: "AI_ANALYZE_QUEUED",
    }), AI_ANALYZE_WORKER_ENDPOINT);
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

  it("wakes extraction then best-effort nudges automatic AI analysis", async () => {
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
      assert.deepEqual(endpoints, [EXTRACT_TEXT_WORKER_ENDPOINT, AI_ANALYZE_WORKER_ENDPOINT]);
      assert.equal(result.fired, true);
      assert.equal(result.endpoint, EXTRACT_TEXT_WORKER_ENDPOINT);
      assert.equal(result.status, "queued");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("directly wakes a server-created AI analysis stage", async () => {
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
        processingJobId: "job-456",
        pipelineStage: "AI_ANALYZE_QUEUED",
      });
      assert.deepEqual(endpoints, [AI_ANALYZE_WORKER_ENDPOINT]);
      assert.equal(result.endpoint, AI_ANALYZE_WORKER_ENDPOINT);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves the upload response contract", () => {
    const response: UploadFirstResponse = {
      success: true,
      tenderId: "t-1",
      nextAction: "WAIT_FOR_SOURCE_EXTRACTION",
      processingJobId: "job-1",
      pipelineStage: "EXTRACT_TEXT_QUEUED",
      requestId: "req-1",
    };
    assert.equal(response.nextAction, "WAIT_FOR_SOURCE_EXTRACTION");
    assert.equal(response.processingJobId, "job-1");
    assert.equal(response.pipelineStage, "EXTRACT_TEXT_QUEUED");
  });
});

describe("queued Company Vault ingestion is actually started", () => {
  it("posts to the worker for the VAULT_INGEST job type", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; method?: string }> = [];
    globalThis.fetch = (async (input, init) => {
      calls.push({ url: String(input), method: init?.method });
      return new Response(JSON.stringify({ ran: 1 }), { status: 200 });
    }) as typeof fetch;
    try {
      await startQueuedVaultIngestion();
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, VAULT_INGEST_WORKER_ENDPOINT);
    assert.equal(calls[0].method, "POST");
    assert.match(calls[0].url, /jobType=VAULT_INGEST/);
  });

  it("stays silent when the worker is unreachable, because the job is durable", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
    try {
      await startQueuedVaultIngestion();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not throw on a worker error response either", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    try {
      await startQueuedVaultIngestion();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
