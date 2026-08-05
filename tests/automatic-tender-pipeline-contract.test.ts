import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const firstUpload = readFileSync("lib/tender-upload-first.ts", "utf8");
const secureUpload = readFileSync("lib/secure-upload-handler.ts", "utf8");
const intakePage = readFileSync("app/dashboard/tenders/new/page.tsx", "utf8");
const generator = readFileSync("lib/engine/generate-elite.ts", "utf8");
const extractionService = readFileSync("lib/ai-jobs/tender-extraction-service.ts", "utf8");
const clientPipeline = readFileSync("lib/ui/auto-pipeline.ts", "utf8");

describe("upload, extraction, and MANUAL continuation contract", () => {
  it("queues durable extraction first", () => {
    assert.match(firstUpload, /enqueueTenderFileExtractionJob\(tx,/);
    assert.doesNotMatch(firstUpload, /queueAutomaticTenderPipeline/);
    assert.match(extractionService, /continueTenderPipelineAfterExtraction/);
    assert.match(firstUpload, /processingJobId/);
  });

  it("extraction does NOT queue AI_ANALYZE — returns EXTRACTION_COMPLETE", () => {
    // Strip comments before checking — the word "queueAutomaticTenderPipeline"
    // appears in comments explaining that it was INTENTIONALLY REMOVED.
    const codeOnly = extractionService
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    assert.doesNotMatch(codeOnly, /queueAutomaticTenderPipeline/);
    assert.match(codeOnly, /EXTRACTION_COMPLETE_MANUAL_AI_ANALYZE_REQUIRED/);
  });

  it("defers continuation until the final large-package batch succeeds", () => {
    assert.match(intakePage, /batches\.length > 1\) form\.append\("deferAnalysis", "true"\)/);
    assert.match(intakePage, /!isFinalBatch \|\| failed > 0/);
    assert.match(secureUpload, /sourcePackageComplete && !uploadBatchFailed/);
  });

  it("the browser nudges ONLY EXTRACT_TEXT — never AI_ANALYZE", () => {
    assert.match(clientPipeline, /run-next\?jobType=EXTRACT_TEXT/);
    // AI_ANALYZE_WORKER_ENDPOINT is intentionally NOT exported.
    assert.doesNotMatch(clientPipeline, /export const AI_ANALYZE_WORKER_ENDPOINT/);
    assert.doesNotMatch(clientPipeline, /void nudgeTenderWorker\(AI_ANALYZE_WORKER_ENDPOINT\)/);
    // The message tells the user to click "Run AI Analyze".
    assert.match(clientPipeline, /Run AI Analyze/i);
  });

  it("never falls back to the full reviewed Vault for positive proposal evidence", () => {
    assert.doesNotMatch(generator, /No experts selected[\s\S]*falling back/);
    assert.doesNotMatch(generator, /No projects selected[\s\S]*falling back/);
    assert.match(generator, /const evidenceLibrary = projects as ProjectRecord\[\]/);
  });
});
