import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const upload = readFileSync("lib/secure-upload-handler.ts", "utf8");
const automaticPipeline = readFileSync("lib/ai-jobs/automatic-tender-pipeline.ts", "utf8");
const extractionService = readFileSync("lib/ai-jobs/tender-extraction-service.ts", "utf8");
// AI_ANALYZE's implementation lives in ai-job-handlers-legacy.ts —
// lib/ai-job-handlers.ts now only re-exports it and locally overrides
// EXTRACT_TEXT's getHandler branch.
const analyze = readFileSync("lib/ai-job-handlers-legacy.ts", "utf8");

describe("server-owned upload pipeline sequencing", () => {
  it("queues source extraction before AI Analyze and never queues Engine concurrently", () => {
    assert.match(upload, /enqueueTenderFileExtractionJob/);
    assert.doesNotMatch(upload, /queueAutomaticTenderPipeline/);
    assert.match(extractionService, /SOURCE_EXTRACTION_PENDING/);
    assert.match(extractionService, /queueAutomaticTenderPipeline/);
    assert.match(automaticPipeline, /jobType: "AI_ANALYZE"/);
    assert.doesNotMatch(upload, /jobType: "ENGINE_RUN"/);
    assert.match(upload, /engineQueued: false/);
  });

  it("deduplicates active AI Analyze jobs by tender and owner", () => {
    assert.match(automaticPipeline, /jobType: "AI_ANALYZE"/);
    assert.match(automaticPipeline, /status: \{ in: \["QUEUED", "RUNNING"\] \}/);
    assert.match(automaticPipeline, /tenderId: input\.tenderId/);
    assert.match(automaticPipeline, /userId: input\.userId/);
  });

  it("requires canonical AI success before generation or export can unlock", () => {
    assert.match(analyze, /Full AI success: ONLY now may we promote canonical data/);
    assert.match(analyze, /Partial \/ fallback \/ provider-exhausted/);
    assert.match(analyze, /do NOT create or\s*\n\s*\/\/ unlock GeneratedDocument rows/);
  });
});
