import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  VAULT_INGEST_WORKER_ENDPOINT,
  decideTenderUploadAutoPipeline,
  startQueuedVaultIngestion,
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
    // AI Analyze is one of the two manual gates. Upload may wake extraction
    // and nothing else, so an AI_ANALYZE_QUEUED stage must NOT hand the client
    // a worker endpoint — otherwise uploading a file would silently perform
    // the analysis the owner is supposed to trigger.
    assert.equal(decideTenderUploadAutoPipeline({
      ...response,
      processingJobId: "job-456",
      pipelineStage: "AI_ANALYZE_QUEUED",
    }), null);
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
    // A GET would be claimed by the route's GET->POST alias, but the filter is
    // what matters: without it the worker may claim some other tenant's job
    // type and leave this vault queued.
    assert.match(calls[0].url, /jobType=VAULT_INGEST/);
  });

  it("stays silent when the worker is unreachable, because the job is durable", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
    try {
      // Must not reject: callers use `void startQueuedVaultIngestion()`, so a
      // rejection here would surface as an unhandled promise rejection and, in
      // the upload path, would do it on every single uploaded document.
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
