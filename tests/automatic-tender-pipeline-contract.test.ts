import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const firstUpload = readFileSync("lib/tender-upload-first.ts", "utf8");
const secureUpload = readFileSync("lib/secure-upload-handler.ts", "utf8");
const intakePage = readFileSync("app/dashboard/tenders/new/page.tsx", "utf8");
const generator = readFileSync("lib/engine/generate-elite.ts", "utf8");
const extractionService = readFileSync("lib/ai-jobs/tender-extraction-service.ts", "utf8");
const automaticPipeline = readFileSync("lib/ai-jobs/automatic-tender-pipeline.ts", "utf8");

describe("upload, extraction, and automatic continuation contract", () => {
  it("queues durable extraction first", () => {
    assert.match(firstUpload, /enqueueTenderFileExtractionJob\(tx,/);
    assert.doesNotMatch(firstUpload, /queueAutomaticTenderPipeline/);
    assert.match(extractionService, /continueTenderPipelineAfterExtraction/);
    assert.match(firstUpload, /processingJobId/);
  });

  it("leaves the prepared AI job runnable for automatic continuation", () => {
    assert.match(extractionService, /queueAutomaticTenderPipeline/);
    assert.match(automaticPipeline, /status:\s*"QUEUED"/);
    assert.match(automaticPipeline, /manualRequested:\s*false/);
    assert.match(automaticPipeline, /autoContinue:\s*true/);
    assert.match(automaticPipeline, /automaticContinuation:\s*true/);
    assert.doesNotMatch(automaticPipeline, /status:\s*"CANCELED"/);
    assert.doesNotMatch(automaticPipeline, /manualGate:\s*"AI_ANALYZE"/);
  });

  it("defers continuation until the final large-package batch succeeds", () => {
    assert.match(intakePage, /batches\.length > 1\) form\.append\("deferAnalysis", "true"\)/);
    assert.match(intakePage, /!isFinalBatch \|\| failed > 0/);
    assert.match(secureUpload, /sourcePackageComplete && !uploadBatchFailed/);
  });

  it("the browser nudges extraction only while later stages remain server-owned", () => {
    const clientPipeline = readFileSync("lib/ui/auto-pipeline.ts", "utf8");
    assert.match(clientPipeline, /\/api\/ai-jobs\/run-next\?jobType=EXTRACT_TEXT/);
    assert.doesNotMatch(clientPipeline, /run-next\?jobType=AI_ANALYZE/);
    assert.match(clientPipeline, /continue automatically through analysis, generation, validation, and package readiness/i);
    assert.match(clientPipeline, /AI analysis is durably queued and will continue automatically/i);
  });

  it("never falls back to the full reviewed Vault for positive proposal evidence", () => {
    assert.doesNotMatch(generator, /No experts selected[\s\S]*falling back/);
    assert.doesNotMatch(generator, /No projects selected[\s\S]*falling back/);
    assert.match(generator, /const evidenceLibrary = projects as ProjectRecord\[\]/);
  });
});
