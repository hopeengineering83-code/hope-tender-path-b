import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { waitForDurableTenderExtraction } from "../e2e/durable-tender-extraction";

type FakeResponse = {
  status(): number;
  json(): Promise<unknown>;
};

describe("durable extraction acceptance helper", () => {
  it("wakes the owned extraction worker and waits for persisted text", async () => {
    let reads = 0;
    let wakes = 0;
    const request = {
      async get(): Promise<FakeResponse> {
        reads += 1;
        return {
          status: () => 200,
          json: async () => ({
            ok: true,
            files: [{
              fileId: "file-1",
              extractedTextLength: reads > 1 ? 42 : 0,
            }],
          }),
        };
      },
      async post(): Promise<FakeResponse> {
        wakes += 1;
        return {
          status: () => 200,
          json: async () => ({
            jobId: "extract-job-1",
            terminalStatus: "SUCCEEDED",
          }),
        };
      },
    };

    const result = await waitForDurableTenderExtraction({
      request: request as never,
      tenderId: "tender-1",
      expectedFileCount: 1,
      timeoutMs: 100,
      pollIntervalMs: 0,
    });

    assert.equal(wakes, 1);
    assert.equal(result.files[0]?.extractedTextLength, 42);
    assert.deepEqual(result.workerJobIds, ["extract-job-1"]);
  });

  it("keeps automatic job visibility and claiming tenant- and tender-scoped", () => {
    const listRoute = readFileSync("app/api/ai-jobs/route.ts", "utf8");
    const jobStore = readFileSync("lib/ai-jobs.ts", "utf8");
    const workerRoute = readFileSync("app/api/ai-jobs/run-next/route.ts", "utf8");
    const claimPolicy = readFileSync("lib/job-claim-policy.ts", "utf8");

    assert.match(listRoute, /parseJobTypeFilter\(searchParams\.get\("jobType"\)\)/);
    assert.match(listRoute, /tenderId = searchParams\.get\("tenderId"\)/);
    assert.match(jobStore, /opts\?\.tenderId \? \{ tenderId: opts\.tenderId \} : \{\}/);
    assert.match(workerRoute, /claimJobForCaller\(\{[\s\S]*?tenderId,[\s\S]*?userId:/);
    assert.match(claimPolicy, /if \(options\.tenderId\) conditions\.push\(Prisma\.sql/);
    assert.match(claimPolicy, /"tenderId" = \$\{options\.tenderId\}/);
  });

  it("all authenticated upload acceptances use the durable helper", () => {
    for (const path of [
      "e2e/golden-tender-workflow.spec.ts",
      "e2e/pr1175-independent-release-audit.spec.ts",
      "e2e/tender-pipeline.spec.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      assert.match(source, /waitForDurableTenderExtraction/);
    }
    const golden = readFileSync("e2e/golden-tender-workflow.spec.ts", "utf8");
    assert.match(golden, /WAIT_FOR_SOURCE_EXTRACTION/);
    assert.match(golden, /EXTRACT_TEXT_QUEUED/);
    // The golden workflow uses MANUAL AI Analyze via POST /api/tenders/:id/manual-ai-analyze.
    assert.match(golden, /manual-ai-analyze/);
    assert.match(golden, /Run AI Analyze/i);
    // The golden workflow uses MANUAL Run Engine via POST /api/tenders/:id/engine.
    assert.match(golden, /\/api\/tenders\/\$\{tenderId\}\/engine/);
    assert.doesNotMatch(golden, /extraction should persist an automatic AI_ANALYZE job/);
  });
});
