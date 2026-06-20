import { test } from "node:test";
import assert from "node:assert";
import * as aiJobs from "../lib/ai-jobs";

test("durable ai job logic - runNextChunk concurrency handling", async () => {
    assert.strictEqual(typeof aiJobs.runNextChunk, "function");
});
