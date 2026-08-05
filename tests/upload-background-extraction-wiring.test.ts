import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const firstUpload = read("lib/tender-upload-first.ts");
const secureUpload = read("lib/secure-upload-handler.ts");
const browserPipeline = read("lib/ui/auto-pipeline.ts");
const readyBoundary = read("lib/ai-jobs/automatic-tender-pipeline.ts");
const legacyHandlers = read("lib/ai-job-handlers-legacy.ts");

describe("upload requests hand verified bytes to durable extraction", () => {
  for (const [name, source] of [
    ["upload-first", firstUpload],
    ["secure upload", secureUpload],
  ] as const) {
    it(`${name} never performs extraction or analysis inside the upload request`, () => {
      assert.doesNotMatch(source, /extractTextFromBuffer/);
      assert.doesNotMatch(source, /queueAutomaticTenderPipeline/);
      assert.match(source, /enqueueTenderFileExtractionJob/);
    });
  }

  it("first-upload rows and deterministic extraction jobs share one transaction", () => {
    const transaction = firstUpload.slice(
      firstUpload.indexOf("const persisted = await prisma.$transaction"),
      firstUpload.indexOf("}, { timeout: 30_000 })"),
    );
    assert.match(transaction, /tx\.tenderFile\.create/);
    assert.match(transaction, /enqueueTenderFileExtractionJob\(tx,/);
    assert.match(transaction, /sourceContentSha256: fileRecord\.contentSha256/);
    assert.match(transaction, /extractedText: null/);
  });

  it("append upload queues extraction after package reconciliation", () => {
    const completion = secureUpload.indexOf("await completeTenderPackageBatch");
    const enqueue = secureUpload.indexOf("await enqueueTenderFileExtractionJob(prisma");
    assert.ok(completion >= 0 && enqueue > completion);
    assert.match(secureUpload, /continueTenderPipelineAfterExtraction/);
    assert.match(secureUpload, /pipelineStage: processingStage/);
  });

  it("company uploads re-extract durable bytes in VAULT_INGEST", () => {
    assert.match(secureUpload, /jobType: "VAULT_INGEST"/);
    assert.match(secureUpload, /reExtractAll: true/);
    assert.match(secureUpload, /aiExtractionStatus: "PENDING"/);
    assert.match(secureUpload, /extractedText: null/);
  });

  it("the browser nudges extraction and automatically queued AI analysis", () => {
    assert.match(browserPipeline, /EXTRACT_TEXT_QUEUED/);
    assert.match(browserPipeline, /AI_ANALYZE_QUEUED/);
    assert.match(browserPipeline, /jobType=EXTRACT_TEXT/);
    assert.match(browserPipeline, /jobType=AI_ANALYZE/);
    assert.match(browserPipeline, /void nudgeTenderWorker\(AI_ANALYZE_WORKER_ENDPOINT\)/);
    assert.match(browserPipeline, /no AI Analyze or Run Engine action is required/i);
    assert.doesNotMatch(browserPipeline, /select AI Analyze|AI Analyze remains explicit/i);
    assert.match(readyBoundary, /status:\s*"QUEUED"/);
    assert.match(readyBoundary, /autoContinue:\s*true/);
    assert.doesNotMatch(readyBoundary, /status:\s*"CANCELED"/);
    assert.doesNotMatch(readyBoundary, /manualGate:\s*"AI_ANALYZE"/);
  });

  it("has exactly one EXTRACT_TEXT implementation", () => {
    assert.doesNotMatch(legacyHandlers, /^\s*EXTRACT_TEXT:\s*async/m);
  });
});
