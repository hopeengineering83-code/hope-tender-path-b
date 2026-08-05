import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyStageRetry, isDurableRetryJobType } from "../lib/engine/stage-retry-policy";
import { getHandler } from "../lib/ai-job-handlers";
import { SUPPORTED_JOB_TYPES } from "../lib/job-type-policy";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("durable upload orchestration", () => {
  // The server-side enqueue module (lib/engine/server-side-ai-enqueue.ts)
  // was deleted: its wiring attempt conflicted with the release branch and
  // was reverted. AI_ANALYZE is now a MANUAL user action triggered via
  // POST /api/tenders/:id/manual-ai-analyze (which calls createAnalysisJob,
  // content-hash idempotent). The extraction service no longer auto-queues
  // AI_ANALYZE — see tests/manual-workflow-regression.test.ts.

  it("VAULT_INGEST job type is registered with a real handler, not just declared", () => {
    // Previously this only checked the string appeared in the JobType union
    // (a producer-less declaration). VAULT_INGEST is now a real, wired,
    // tested background job — see tests/vault-ingest-job.test.ts for full
    // end-to-end coverage (real Company/CompanyDocument rows, real claim +
    // execute, real Expert draft persisted).
    assert.ok((SUPPORTED_JOB_TYPES as readonly string[]).includes("VAULT_INGEST"));
    assert.ok(getHandler("VAULT_INGEST"), "VAULT_INGEST must have a registered handler");
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
    // recordSafeStageEvent is now a real, called dependency of the
    // VAULT_INGEST handler (see tests/vault-ingest-job.test.ts, which
    // asserts a real "[job-stage]" log line is emitted end to end) — not
    // just a defined-but-unused module.
    // VAULT_INGEST's implementation lives in ai-job-handlers-legacy.ts —
    // lib/ai-job-handlers.ts now only re-exports it and locally overrides
    // EXTRACT_TEXT's getHandler branch.
    const handlers = read("lib/ai-job-handlers-legacy.ts");
    assert.match(handlers, /import \{ recordSafeStageEvent \} from "\.\/engine\/stage-observability"/);
    assert.match(handlers, /recordSafeStageEvent\(/);
  });

  // Note: lib/engine/stage-checkpoint-recovery.ts (parseStageCheckpoint) was
  // deleted. Real per-item checkpoint/resume for VAULT_INGEST would require
  // refactoring ingestCompanyVault to process CompanyDocuments incrementally
  // instead of batching all of a company's usable documents into one/two AI
  // calls — a real change to well-established extraction logic, out of
  // scope for this pass. Wiring the checkpoint module in without that
  // refactor would have been decorative, not functional, so it was removed
  // rather than left as an unused "connected-looking" dependency.
});
