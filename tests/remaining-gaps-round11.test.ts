/**
 * Regression tests for remaining production gaps (round 11).
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// Retargeted from lib/ai-jobs/worker.ts, which was deleted. That module was a
// second job-worker implementation with no production importer: the live drain
// path is app/api/ai-jobs/run-next/route.ts -> lib/job-claim-policy.ts, and
// the claim itself is lib/ai-jobs.ts claimNextJob(). Asserting SKIP LOCKED in
// the dead module proved nothing about how jobs are actually claimed.
//
// claimNextJob uses a different but equally race-safe technique: a
// compare-and-swap. Two workers may both read the same QUEUED row, but the
// conditional updateMany only matches while status is still QUEUED, so exactly
// one sees count > 0 and the loser returns null instead of double-running it.
describe("round 11 — T1: the live job claim is race-safe", () => {
  const src = read("lib/ai-jobs.ts");

  it("claims with a conditional update guarded on the still-QUEUED status", () => {
    assert.ok(src.includes("export async function claimNextJob"), "claimNextJob is the live claim");
    assert.match(
      src,
      /updateMany\(\{\s*where:\s*\{\s*id:\s*candidate\.id,\s*status:\s*"QUEUED"\s*\}/,
      "the update must be conditional on the row still being QUEUED",
    );
  });

  it("treats a lost race as 'not claimed' rather than running the job twice", () => {
    assert.match(src, /if \(updated\.count === 0\) return null;/);
  });

  it("has no second, competing worker implementation", () => {
    assert.equal(existsSync("lib/ai-jobs/worker.ts"), false, "a duplicate job worker must not exist");
    assert.match(read("app/api/ai-jobs/run-next/route.ts"), /claimJobForCaller/);
  });
});

describe("round 11 — T2: tender delete durable storage cleanup", () => {
  const route = read("app/api/tenders/[id]/route.ts");
  const deletion = read("lib/tender/delete-tender.ts");
  const task = read("lib/tender/tender-storage-cleanup-task.ts");

  it("captures external storage pointers and commits the task before Tender deletion", () => {
    assert.ok(deletion.includes("tenderFile.findMany"), "must query TenderFile storage paths inside deletion transaction");
    assert.ok(deletion.includes("generatedDocument.findMany"), "must query GeneratedDocument storage paths inside deletion transaction");
    const taskPos = deletion.indexOf("createTenderStorageCleanupTask({");
    const tenderDeletePos = deletion.indexOf('wrapDelete("Tender"');
    assert.ok(taskPos >= 0 && tenderDeletePos > taskPos, "cleanup task must be durable before final Tender deletion");
  });

  it("processes the committed task after transaction and preserves retry state", () => {
    assert.ok(route.includes("processTenderStorageCleanupTask"), "must process the durable cleanup task after commit");
    assert.ok(route.includes("storageCleanupPending"), "must report pending cleanup without exposing internal paths");
    assert.ok(task.includes("remaining.push(file)"), "failed objects must remain in the manifest for retry");
    assert.ok(!route.includes("filesForCleanup"), "ephemeral cleanup arrays must not return");
    const deleteRegion = route.slice(route.indexOf("export async function DELETE"));
    assert.ok(!deleteRegion.includes(".deleteFile({"), "the route must not perform direct best-effort Blob deletion");
  });
});

describe("round 11 — T5: auto-finalize transaction", () => {
  const src = read("app/api/tenders/[id]/auto-finalize/route.ts");

  // This used to require `tx.documentReview.create` inside the transaction.
  // A DocumentReview row is a record that a HUMAN reviewed the document, and
  // the same write set marked the row READY_FOR_EXPORT with reviewedBy and
  // reviewedAt. Automation writing that is fabricated human state, so it was
  // removed — the assertion, not the route, was wrong. Requiring the write
  // back would re-introduce exactly the fabrication the app forbids.
  //
  // The atomicity guarantee the test was really protecting still holds and is
  // still asserted; the no-fabrication guarantee is now pinned beside it so
  // neither can regress into the other.
  it("keeps the byte/status update atomic", () => {
    assert.ok(src.includes("prisma.$transaction(async (tx)"), "must use $transaction for the update");
    assert.ok(src.includes("tx.generatedDocument.update"), "must use tx for the update");
  });

  it("never fabricates human review state while finalizing", () => {
    assert.ok(!src.includes("tx.documentReview.create"),
      "a DocumentReview row asserts a human reviewed this document; automation must not create one");
    assert.ok(!/reviewedBy:\s*actor\.id/.test(src), "automation must not write reviewedBy");
    assert.ok(!/reviewedAt:\s*new Date\(\)/.test(src), "automation must not write reviewedAt");
    // Machine-safe fields only: the Document Validator owns VALIDATED, and the
    // human reviewStatus is left for a human.
    assert.ok(/validationStatus:\s*"PENDING"/.test(src), "automation leaves validation to the canonical validator");
  });
});


// Retargeted from the deleted lib/ai-jobs/worker.ts to the live classifier in
// lib/ai.ts. The property that matters is unchanged: an error the classifier
// does not recognise must NOT be treated as retryable, or an unknown permanent
// failure becomes a retry storm.
describe("round 11 — F1: unknown errors are not retried", () => {
  it("isTransientChunkError falls through to false for unrecognised errors", async () => {
    const { isTransientChunkError } = await import("../lib/ai");
    assert.equal(isTransientChunkError(new Error("totally unrecognised failure")), false);
    assert.equal(isTransientChunkError(null), false);
    assert.equal(isTransientChunkError({}), false);
  });

  it("still recognises genuinely transient conditions as retryable", async () => {
    const { isTransientChunkError } = await import("../lib/ai");
    const transient = [new Error("429 Too Many Requests"), new Error("ETIMEDOUT"), new Error("503 Service Unavailable")];
    assert.ok(
      transient.some((err) => isTransientChunkError(err)),
      "the classifier must still retry real transient failures",
    );
  });
});

describe("round 11 — M3: login route IP trust", () => {
  const src = read("app/api/auth/login/route.ts");

  it("uses the shared getClientIp helper (not unconditionally trusting XFF)", () => {
    assert.ok(src.includes("import { getClientIp }"), "must import getClientIp from lib/request-ip");
    assert.ok(src.includes("getClientIp(req)"), "must call getClientIp(req) (was clientIp(req))");
    assert.ok(
      !src.includes("function clientIp(req: Request)"),
      "old clientIp function must be removed (was unconditionally trusting XFF)",
    );
  });
});

describe("round 11 — analytics route pagination", () => {
  const src = read("app/api/analytics/route.ts");

  it("adds take: 100 pagination", () => {
    assert.ok(src.includes("take: 100"), "must add take: 100 (was unbounded)");
  });

  it("filters complianceGaps to unresolved-only", () => {
    assert.ok(
      src.includes("complianceGaps: { select: { severity: true, isResolved: true }, where: { isResolved: false } }"),
      "must filter complianceGaps to unresolved-only (was loading ALL gaps)",
    );
  });
});

describe("round 11 — workflow-center N+1 batch fix", () => {
  const src = read("lib/engine/tender-release-snapshot.ts");

  it("batches extractionQualityOverride lookups into ONE query", () => {
    assert.ok(
      src.includes("extractionQualityOverride.findMany"),
      "must use findMany (batch) instead of count per file (was N+1)",
    );
    assert.ok(
      src.includes("tenderFileId: { in: weakFileIds }"),
      "must use IN clause for batch lookup",
    );
    assert.ok(
      src.includes("distinct: [\"tenderFileId\"]"),
      "must use distinct to avoid duplicate rows",
    );
  });

  it("uses a Set for O(1) override lookup", () => {
    assert.ok(src.includes("overrideFileIds"), "must build an overrideFileIds Set");
    assert.ok(src.includes("overrideFileIds.has"), "must use .has() for O(1) lookup");
  });

  // Regression: the batch query filtered on `status: "ACTIVE"`, a column
  // ExtractionQualityOverride has never had (confirmed against its migration,
  // prisma/migrations/20260622193000_add_readiness_durable_records/migration.sql
  // -- one row per (tenderId, tenderFileId) IS the active override; there is
  // no status lifecycle). Every real Prisma call hit this and threw
  // PrismaClientValidationError, so hasOverride was always silently wrong
  // (Playwright's WebServer logs surfaced this live on a running server).
  it("does not filter on a nonexistent `status` column", () => {
    assert.ok(
      !src.includes('status: "ACTIVE"'),
      "ExtractionQualityOverride has no status column -- this always threw PrismaClientValidationError at runtime",
    );
  });

  it("filters the batch lookup by the same staleness window as the canonical single-file check", () => {
    assert.ok(
      src.includes("import { EXTRACTION_OVERRIDE_MAX_AGE_MS } from \"./readiness-overrides\""),
      "must import the canonical staleness window from readiness-overrides.ts",
    );
    assert.match(
      src,
      /overriddenAt:\s*\{\s*gte:\s*new Date\(Date\.now\(\)\s*-\s*EXTRACTION_OVERRIDE_MAX_AGE_MS\)\s*\}/,
      "must exclude overrides older than EXTRACTION_OVERRIDE_MAX_AGE_MS, matching hasActiveExtractionOverride()",
    );
  });
});
