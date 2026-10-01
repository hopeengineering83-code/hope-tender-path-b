import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const upload = readFileSync("lib/secure-upload-handler.ts", "utf8");
const extractionService = readFileSync("lib/ai-jobs/tender-extraction-service.ts", "utf8");
const manualAnalyze = readFileSync("app/api/tenders/[id]/manual-ai-analyze/route.ts", "utf8");
const analyze = readFileSync("lib/ai-job-handlers-legacy.ts", "utf8");

describe("upload pipeline sequencing — manual AI Analyze / manual Run Engine", () => {
  it("queues extraction and never performs AI Analyze or Engine inside the upload transaction", () => {
    assert.match(upload, /enqueueTenderFileExtractionJob/);
    assert.doesNotMatch(upload, /queueAutomaticTenderPipeline/);
    assert.doesNotMatch(upload, /jobType: "AI_ANALYZE"/);
    assert.doesNotMatch(upload, /jobType: "ENGINE_RUN"/);
    assert.match(upload, /engineQueued: false/);
  });

  it("extraction does NOT queue AI_ANALYZE — returns EXTRACTION_COMPLETE", () => {
    // Strip comments before checking — the word "queueAutomaticTenderPipeline"
    // appears in comments explaining that it was INTENTIONALLY REMOVED.
    const codeOnly = extractionService
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    // The actual code must NOT call queueAutomaticTenderPipeline.
    assert.doesNotMatch(codeOnly, /queueAutomaticTenderPipeline/);
    assert.match(codeOnly, /EXTRACTION_COMPLETE_MANUAL_AI_ANALYZE_REQUIRED/);
  });

  it("manual AI Analyze route is idempotent and tenant-safe", () => {
    // FIX 1: After the atomic-manual-authority refactor, the route forwards
    // a manualAuthority parameter into createAnalysisJob(). The atomic
    // persistence of manualRequested=true and autoContinue=false happens in
    // the service, not in a separate updateMany patch.
    assert.match(manualAnalyze, /createAnalysisJob/);
    assert.match(manualAnalyze, /where:\s*\{ id: tenderId, userId: actor\.id \}/);
    assert.match(manualAnalyze, /manualAuthority:/);
    assert.match(manualAnalyze, /source: "manual-ai-analyze"/);
    assert.match(manualAnalyze, /actorUserId: actor\.id/);
    const service = readFileSync("lib/ai-jobs/analysis-job-service.ts", "utf8");
    assert.match(service, /manualRequested: true/);
    assert.match(service, /autoContinue: false/);
    assert.match(service, /status: \{ in: \["QUEUED", "RUNNING", "PARTIAL_SUCCESS", "FAILED"\] \}/);
    assert.match(service, /tenderId/);
    assert.match(service, /userId/);
    // The race-window updateMany patch must NOT exist in the route.
    assert.doesNotMatch(manualAnalyze, /prisma\.aiJob\.updateMany/);
  });

  it("requires canonical AI success before generation or export can unlock", () => {
    assert.match(analyze, /Full AI success: ONLY now may we promote canonical data/);
    assert.match(analyze, /Partial \/ fallback \/ provider-exhausted/);
    assert.match(analyze, /do NOT create or\s*\n\s*\/\/ unlock GeneratedDocument rows/);
  });
});
