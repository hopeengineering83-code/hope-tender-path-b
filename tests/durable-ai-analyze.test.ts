import { test } from "node:test";
import assert from "node:assert";
import * as aiJobs from "../lib/ai-jobs";

test("durable ai job logic - structural verification", async () => {
    assert.strictEqual(typeof aiJobs.createAnalysisJob, "function", "createAnalysisJob should be a function");
    assert.strictEqual(typeof aiJobs.runNextChunk, "function", "runNextChunk should be a function");
    assert.strictEqual(typeof aiJobs.finalizeJob, "function", "finalizeJob should be a function");
});

test("durable ai job logic - chunking", () => {
    const text = "A".repeat(100000);
    const chunks = aiJobs.chunkTenderContent(text);
    assert.ok(chunks.length > 1, "Should create multiple chunks for 100k chars");
    assert.ok(chunks[0].length <= 80000, "First chunk should be within limit");
});
