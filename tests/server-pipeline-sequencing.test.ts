import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const upload = readFileSync("lib/secure-upload-handler.ts", "utf8");
const readyBoundary = readFileSync("lib/ai-jobs/automatic-tender-pipeline.ts", "utf8");
const extractionService = readFileSync("lib/ai-jobs/tender-extraction-service.ts", "utf8");
const manualAnalyze = readFileSync("app/api/tenders/[id]/manual-ai-analyze/route.ts", "utf8");
const analyze = readFileSync("lib/ai-job-handlers-legacy.ts", "utf8");

describe("upload pipeline sequencing", () => {
  it("queues extraction and never queues AI Analyze or Engine from upload", () => {
    assert.match(upload, /enqueueTenderFileExtractionJob/);
    assert.doesNotMatch(upload, /queueAutomaticTenderPipeline/);
    assert.doesNotMatch(upload, /jobType: "AI_ANALYZE"/);
    assert.doesNotMatch(upload, /jobType: "ENGINE_RUN"/);
    assert.match(upload, /engineQueued: false/);
  });

  it("parks the prepared analysis checkpoint as canceled and non-runnable", () => {
    assert.match(extractionService, /queueAutomaticTenderPipeline/);
    assert.match(readyBoundary, /createAnalysisJob/);
    assert.match(readyBoundary, /manualRequested !== true/);
    assert.match(readyBoundary, /status:\s*"CANCELED"/);
    assert.match(readyBoundary, /autoContinue:\s*false/);
    assert.match(readyBoundary, /manualGate:\s*"AI_ANALYZE"/);
    assert.match(readyBoundary, /Awaiting the explicit AI Analyze action/);
    assert.doesNotMatch(readyBoundary, /run-next\?jobType=AI_ANALYZE/);
  });

  it("deduplicates real AI Analyze jobs through the explicit route and service", () => {
    assert.match(manualAnalyze, /createAnalysisJob/);
    assert.match(manualAnalyze, /where:\s*\{ id: tenderId, userId: actor\.id \}/);
    assert.match(manualAnalyze, /manualRequested:\s*true/);
    const service = readFileSync("lib/ai-jobs/analysis-job-service.ts", "utf8");
    assert.match(service, /status: \{ in: \["QUEUED", "RUNNING", "PARTIAL_SUCCESS", "FAILED"\] \}/);
    assert.match(service, /tenderId/);
    assert.match(service, /userId/);
  });

  it("requires canonical AI success before generation or export can unlock", () => {
    assert.match(analyze, /Full AI success: ONLY now may we promote canonical data/);
    assert.match(analyze, /Partial \/ fallback \/ provider-exhausted/);
    assert.match(analyze, /do NOT create or\s*\n\s*\/\/ unlock GeneratedDocument rows/);
  });
});
