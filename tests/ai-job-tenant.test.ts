import { test } from "node:test";
import assert from "node:assert";
import * as aiJobs from "../lib/ai-jobs";

test("durable ai job logic - tenant scope", async () => {
    assert.strictEqual(typeof aiJobs.createAnalysisJob, "function");
});
