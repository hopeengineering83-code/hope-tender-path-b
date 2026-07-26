import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyStageRetry, isDurableRetryJobType } from "../lib/engine/stage-retry-policy";
import { parseStageCheckpoint } from "../lib/engine/stage-checkpoint-recovery";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("durable upload orchestration", () => {
  it("enqueues AI_ANALYZE inside the server upload handler", () => {
    const server = read("lib/tender-upload-first.ts");
    const client = read("app/dashboard/tenders/new/page.tsx");
    assert.match(server, /enqueueAiAnalyzeServerSide/);
    assert.match(server, /serverEnqueue/);
    assert.doesNotMatch(client, /triggerTenderUploadAutoPipeline/);
    assert.match(client, /AI_ANALYZE is durably enqueued by the upload-first server handler/);
  });

  it("queues one selected CompanyDocument package instead of importing the whole vault in-request", () => {
    const upload = read("lib/secure-upload-handler.ts");
    assert.match(upload, /jobType: "VAULT_INGEST"/);
    assert.match(upload, /documentIds: companyDocumentIds/);
    assert.doesNotMatch(upload, /importCompanyKnowledgeFromDocuments\(company\.id\)/);
  });

  it("registers all recovery stages as durable job types", () => {
    for (const value of ["EXTRACT_TEXT", "VAULT_INGEST", "ENGINE_RUN"]) assert.equal(isDurableRetryJobType(value), true);
  });

  it("retries known transient failures with bounded stage backoff", () => {
    assert.deepEqual(classifyStageRetry("ETIMEDOUT contacting provider", 0), {
      retryable: true, blockerCode: "TRANSIENT_STAGE_FAILURE", delayMs: 30_000,
    });
    assert.equal(classifyStageRetry("rate limit", 4).retryable, false);
  });

  it("never retries authority, integrity, or review blockers", () => {
    for (const blocker of ["AUTHORITY_BLOCKED", "INTEGRITY_FAILED", "REVIEW_REQUIRED", "CONTENT_HASH_MISMATCH"]) {
      assert.equal(classifyStageRetry(blocker, 0).retryable, false);
    }
  });

  it("claiming uses FOR UPDATE SKIP LOCKED and stage logs expose only an allowlisted shape", () => {
    // The release branch version of job-claim-policy uses FOR UPDATE SKIP
    // LOCKED instead of nextAttemptAt — both prevent duplicate claims, but
    // the release branch version is simpler and doesn't require a
    // nextAttemptAt column. Verify the atomic claim pattern is present.
    assert.match(read("lib/job-claim-policy.ts"), /FOR UPDATE SKIP LOCKED/);
    const observability = read("lib/engine/stage-observability.ts");
    for (const field of ["deploymentSha", "sourceRevision", "durationMs", "queueAgeMs", "retryCount", "blockerCode", "artifactIntegrityStatus"]) {
      assert.match(observability, new RegExp(field));
    }
    assert.doesNotMatch(observability, /documentText|storagePath|credentials|rawError/);
  });

  it("resumes only checkpoints for the same stage and source revision", () => {
    const output = JSON.stringify({ checkpoint: { stage: "VAULT_INGEST", sourceRevision: "rev-1", completedItemIds: ["doc-1", "doc-1"], updatedAt: new Date().toISOString() } });
    assert.deepEqual(parseStageCheckpoint(output, "VAULT_INGEST", "rev-1").completedItemIds, ["doc-1"]);
    assert.deepEqual(parseStageCheckpoint(output, "VAULT_INGEST", "rev-2").completedItemIds, []);
    assert.deepEqual(parseStageCheckpoint("malformed", "VAULT_INGEST", "rev-1").completedItemIds, []);
  });
});
