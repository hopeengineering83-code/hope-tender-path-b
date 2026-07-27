import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { SUPPORTED_JOB_TYPES, parseJobTypeFilter } from "../lib/job-type-policy";
import type { JobType } from "../lib/ai-jobs";
import { tenderExtractionRunId } from "../lib/ai-jobs/tender-extraction-service";

const read = (path: string) => readFileSync(path, "utf8");

describe("EXTRACT_TEXT job — type, policy and canonical ownership", () => {
  it("is a supported durable job type", () => {
    const jobType: JobType = "EXTRACT_TEXT";
    assert.equal(jobType, "EXTRACT_TEXT");
    assert.ok((SUPPORTED_JOB_TYPES as readonly string[]).includes("EXTRACT_TEXT"));
    assert.deepEqual(parseJobTypeFilter("EXTRACT_TEXT"), { ok: true, value: "EXTRACT_TEXT" });
    assert.deepEqual(parseJobTypeFilter("unknown"), { ok: false, code: "INVALID_JOB_TYPE" });
  });

  it("has one deterministic identity per file and byte revision", () => {
    const first = tenderExtractionRunId({ tenderFileId: "file-1", sourceContentSha256: "a".repeat(64) });
    const replay = tenderExtractionRunId({ tenderFileId: "file-1", sourceContentSha256: "A".repeat(64) });
    const revised = tenderExtractionRunId({ tenderFileId: "file-1", sourceContentSha256: "b".repeat(64) });
    assert.equal(first, replay);
    assert.notEqual(first, revised);
  });

  it("the canonical registry overrides the historical extraction handler", () => {
    const registry = read("lib/ai-job-handlers.ts");
    assert.match(registry, /jobType === "EXTRACT_TEXT"/);
    assert.match(registry, /runTenderFileExtractionJob/);
    assert.match(registry, /getLegacyHandler\(jobType\)/);
  });
});

describe("EXTRACT_TEXT job — tenant, revision and byte integrity", () => {
  const source = read("lib/ai-jobs/tender-extraction-service.ts");

  it("requires tender ownership and an active exact-hash source row", () => {
    assert.match(source, /where: \{ id: ctx\.tenderId, userId: ctx\.userId \}/);
    assert.match(source, /contentSha256: expectedHash/);
    assert.match(source, /deletionStatus: "ACTIVE"/);
    assert.match(source, /EXTRACTION_SCOPE_SUPERSEDED/);
    assert.match(source, /SOURCE_REVISION_SUPERSEDED/);
  });

  it("re-verifies persisted bytes before extraction", () => {
    assert.match(source, /getStorageAdapter\(\)\.getFile/);
    assert.match(source, /requireVerifiedPersistedFileBytes/);
    assert.ok(source.indexOf("requireVerifiedPersistedFileBytes") < source.indexOf("extractTextFromBuffer"));
  });

  it("guards persistence against concurrent source changes", () => {
    assert.match(source, /tenderFile\.updateMany/);
    assert.match(source, /updatedAt: file\.updatedAt/);
    assert.match(source, /contentSha256: expectedHash/);
    assert.match(source, /SOURCE_CHANGED_DURING_EXTRACTION/);
  });

  it("persists complete extraction state", () => {
    assert.match(source, /extractedText: extractedText \|\| null/);
    assert.match(source, /totalPages: metrics\.totalPages/);
    assert.match(source, /extractedPages: metrics\.extractedPages/);
    assert.match(source, /ocrPages: metrics\.ocrPages/);
    assert.match(source, /failedPages: metrics\.failedPages/);
    assert.match(source, /extractionScore: metrics\.extractionScore/);
    assert.match(source, /extractionMethod: metrics\.extractionMethod/);
    assert.match(source, /pageStatusJson: metrics\.pageStatusJson/);
  });

  it("uses a durable file-level checkpoint on worker retry", () => {
    assert.match(source, /if \(!metrics\)/);
    assert.match(source, /stepName: "extract\.resume"/);
    assert.match(source, /Reusing the durable file-level extraction checkpoint/);
  });
});

describe("EXTRACT_TEXT job — source-grounded continuation", () => {
  const source = read("lib/ai-jobs/tender-extraction-service.ts");

  it("runs metadata and candidate enrichment only from current source files", () => {
    assert.match(source, /autoFillTenderMetadata/);
    assert.match(source, /enrichMetadataWithSourceEvidence/);
    assert.match(source, /buildCandidatesFromMetadata/);
    assert.match(source, /extractionSourcePrefix: "extract-text-job"/);
    assert.match(source, /sourceStillCurrent/);
  });

  it("waits for package completeness and all active source extractions", () => {
    assert.match(source, /SOURCE_PACKAGE_INCOMPLETE/);
    assert.match(source, /SOURCE_EXTRACTION_PENDING/);
    assert.match(source, /SOURCE_EXTRACTION_REVIEW_REQUIRED/);
    assert.match(source, /queueAutomaticTenderPipeline/);
    assert.match(source, /recordTenderPackageAnalysisJob/);
  });

  it("records worker progress and a durable audit event", () => {
    for (const step of ["extract.scope", "extract.storage-read", "extract.run", "extract.resume", "extract.complete"]) {
      assert.ok(source.includes(`stepName: "${step}"`));
    }
    assert.match(source, /action: "TENDER_FILE_EXTRACTION"/);
  });

  it("worker remains bounded to one extraction job per invocation", () => {
    const worker = read("app/api/ai-jobs/run-next/route.ts");
    assert.ok(worker.includes('"EXTRACT_TEXT"') && worker.includes(".includes(claimed.jobType)"));
  });
});
