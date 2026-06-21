import { test } from "node:test";
import assert from "node:assert";
import * as aiJobs from "../lib/ai-jobs";

test("durable ai job logic - structural", async () => {
    assert.strictEqual(typeof aiJobs.createAnalysisJob, "function");
    assert.strictEqual(typeof aiJobs.runNextChunk, "function");
    assert.strictEqual(typeof aiJobs.finalizeJob, "function");
});
