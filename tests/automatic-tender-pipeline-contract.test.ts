import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const firstUpload = readFileSync("lib/tender-upload-first.ts", "utf8");
const secureUpload = readFileSync("lib/secure-upload-handler.ts", "utf8");
const intakePage = readFileSync("app/dashboard/tenders/new/page.tsx", "utf8");
const generator = readFileSync("lib/engine/generate-elite.ts", "utf8");
const extractionService = readFileSync("lib/ai-jobs/tender-extraction-service.ts", "utf8");

describe("upload-and-continue tender pipeline contract", () => {
  it("queues durable extraction first and lets the worker continue analysis", () => {
    assert.match(firstUpload, /enqueueTenderFileExtractionJob\(tx,/);
    assert.doesNotMatch(firstUpload, /queueAutomaticTenderPipeline/);
    assert.match(extractionService, /continueTenderPipelineAfterExtraction/);
    assert.match(extractionService, /queueAutomaticTenderPipeline/);
    assert.match(firstUpload, /processingJobId/);
  });

  it("defers analysis until the final large-package batch succeeds", () => {
    assert.match(intakePage, /batches\.length > 1\) form\.append\("deferAnalysis", "true"\)/);
    assert.match(intakePage, /!isFinalBatch \|\| failed > 0/);
    assert.match(secureUpload, /sourcePackageComplete && !uploadBatchFailed/);
  });

  it("wakes only the worker for a durable server-created job", () => {
    const clientPipeline = readFileSync("lib/ui/auto-pipeline.ts", "utf8");
    assert.match(clientPipeline, /response\.processingJobId/);
    assert.match(clientPipeline, /\/api\/ai-jobs\/run-next\?jobType=EXTRACT_TEXT/);
    assert.match(clientPipeline, /\/api\/ai-jobs\/run-next\?jobType=AI_ANALYZE/);
    assert.doesNotMatch(clientPipeline, /\/api\/tenders\/\$\{.*\}\/ai-analyze/);
  });

  it("never falls back to the full reviewed Vault for positive proposal evidence", () => {
    assert.doesNotMatch(generator, /No experts selected[\s\S]*falling back/);
    assert.doesNotMatch(generator, /No projects selected[\s\S]*falling back/);
    assert.match(generator, /const evidenceLibrary = projects as ProjectRecord\[\]/);
  });
});
