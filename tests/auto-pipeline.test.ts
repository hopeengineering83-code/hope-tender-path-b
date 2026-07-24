import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  decideTenderUploadAutoPipeline,
  triggerTenderUploadAutoPipeline,
  type UploadFirstResponse,
} from "../lib/ui/auto-pipeline";

describe("server-owned tender pipeline", () => {
  it("never returns a client mutation decision", () => {
    const response: UploadFirstResponse = {
      success: true,
      tenderId: "tender-abc",
      engineSkipped: true,
      nextAction: "RUN_AI_ANALYZE",
    };
    assert.equal(decideTenderUploadAutoPipeline(response), null);
  });

  it("does not POST AI Analyze from the browser", async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error("client fetch must not run");
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

  it("surfaces a server-created processing job without creating another job", async () => {
    const result = await triggerTenderUploadAutoPipeline({
      success: true,
      tenderId: "tender-abc",
      processingJobId: "job-123",
    });
    assert.equal(result.fired, false);
    assert.equal(result.endpoint, null);
    assert.equal(result.status, "queued");
    assert.match(result.message, /server pipeline queued/i);
  });

  it("preserves the upload response contract", () => {
    const response: UploadFirstResponse = {
      success: true,
      tenderId: "t-1",
      engineSkipped: true,
      nextAction: "RUN_AI_ANALYZE",
      processingJobId: "job-1",
      requestId: "req-1",
    };
    assert.equal(response.engineSkipped, true);
    assert.equal(response.nextAction, "RUN_AI_ANALYZE");
    assert.equal(response.processingJobId, "job-1");
  });
});
