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
    assert.match(
      golden,
      /completedExtractionJson\.job\.output\?\.continuation\?\.reason\)\.toBe\("AI_ANALYZE_QUEUED"\)/,
    );
    assert.doesNotMatch(golden, /job\.output \?\? ""\)\.toContain/);
    assert.doesNotMatch(golden, /expect\(intakeJson\.nextAction\)\.toBe\("WAIT_FOR_AI_ANALYZE"\)/);
  });
});
