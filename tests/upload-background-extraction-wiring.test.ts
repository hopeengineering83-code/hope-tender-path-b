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
    it(`${name} never performs extraction or queues analysis directly`, () => {
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

  it("the browser wakes extraction only and leaves AI Analyze explicit", () => {
    assert.match(browserPipeline, /EXTRACT_TEXT_QUEUED/);
    assert.match(browserPipeline, /AI_ANALYZE_QUEUED/);
    assert.match(browserPipeline, /jobType=EXTRACT_TEXT/);
    assert.doesNotMatch(browserPipeline, /jobType=AI_ANALYZE/);
    assert.match(browserPipeline, /AI Analyze remains an explicit action|select AI Analyze/i);
    assert.match(readyBoundary, /status:\s*"CANCELED"/);
    assert.match(readyBoundary, /manualGate:\s*"AI_ANALYZE"/);
  });

  it("has exactly one EXTRACT_TEXT implementation", () => {
    assert.doesNotMatch(legacyHandlers, /^\s*EXTRACT_TEXT:\s*async/m);
  });
});
