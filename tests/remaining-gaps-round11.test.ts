/**
 * Regression tests for remaining production gaps (round 11).
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("round 11 — T1: worker.ts atomic job claiming", () => {
  const src = read("lib/ai-jobs/worker.ts");

  it("uses UPDATE...FOR UPDATE SKIP LOCKED for atomic job claiming", () => {
    assert.ok(src.includes("FOR UPDATE SKIP LOCKED"), "must use FOR UPDATE SKIP LOCKED (was non-atomic findMany+update)");
    assert.ok(src.includes("RETURNING id"), "must RETURNING the claimed jobs (atomic claim)");
  });

  it("removes the old non-atomic findMany + separate update", () => {
    assert.ok(
      !src.includes('prisma.aiJob.findMany({\n    where: {\n      jobType: "AI_ANALYZE"'),
      "old non-atomic findMany must be removed",
    );
    assert.ok(
      !src.includes("// Mark job as RUNNING\n      await prisma.aiJob.update"),
      "old separate RUNNING update must be removed (atomic claim does it)",
    );
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

  it("wraps update + DocumentReview create in a transaction", () => {
    assert.ok(src.includes("prisma.$transaction(async (tx)"), "must use $transaction for update + audit");
    assert.ok(src.includes("tx.generatedDocument.update"), "must use tx for the update");
    assert.ok(src.includes("tx.documentReview.create"), "must use tx for the audit create");
  });
});

describe("round 11 — T4: attach-original old blob cleanup", () => {
  const src = read("app/api/tenders/[id]/documents/[docId]/attach-original/route.ts");

  it("captures priorStoragePath before the update", () => {
    assert.ok(src.includes("priorStoragePath"), "must capture priorStoragePath");
    assert.ok(src.includes("priorFileContent"), "must capture priorFileContent");
  });

  it("cleans up the old blob after the transaction", () => {
    assert.ok(src.includes("Best-effort cleanup of the OLD blob"), "must clean up old blob");
    assert.ok(src.includes("priorStoragePath || priorFileContent"), "must guard on prior blob existing");
  });

  it("includes storagePath + fileContent in the doc select", () => {
    assert.ok(src.includes("storagePath: true"), "must select storagePath");
    assert.ok(src.includes("fileContent: true"), "must select fileContent");
  });
});

describe("round 11 — F1: worker.ts retry storm fix", () => {
  const src = read("lib/ai-jobs/worker.ts");

  it("defaults unknown errors to NON-transient (no retry)", () => {
    assert.ok(
      src.includes("Default: NON-transient"),
      "must default to non-transient (was true → retry storm on unknown errors)",
    );
    assert.ok(
      src.includes("return false;"),
      "must return false for unknown errors (was return true)",
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
