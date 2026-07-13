/**
 * Regression tests for final remaining gaps (round 12).
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("round 12 — R1: generate-elite.ts TOCTOU fix", () => {
  const src = read("lib/engine/generate-elite.ts");

  it("wraps Technical Proposal findFirst+update/create in a transaction", () => {
    // The TOCTOU race: two concurrent /generate calls both pass findFirst
    // (existing=null) and both create duplicate rows. Now wrapped in $transaction.
    const txCount = (src.match(/prisma\.\$transaction\(async \(tx\)/g) ?? []).length;
    assert.ok(txCount >= 2, `must have at least 2 $transaction calls (Technical Proposal + Expert CVs), found ${txCount}`);
  });

  it("uses tx.generatedDocument (not prisma.generatedDocument) inside transactions", () => {
    // #1058 introduced withTransactionalGenerationGate which uses lockedTx
    // (the locked transaction handle) instead of plain tx. The test should
    // accept either tx.generatedDocument or lockedTx.generatedDocument.
    assert.ok(
      src.includes("lockedTx.generatedDocument.findFirst") || src.includes("tx.generatedDocument.findFirst"),
      "must use tx or lockedTx for findFirst inside the transaction",
    );
    assert.ok(
      src.includes("lockedTx.generatedDocument.update") || src.includes("tx.generatedDocument.update"),
      "must use tx or lockedTx for update inside the transaction",
    );
    assert.ok(
      src.includes("lockedTx.generatedDocument.create") || src.includes("tx.generatedDocument.create"),
      "must use tx or lockedTx for create inside the transaction",
    );
  });
});

describe("round 12 — O2: cleanup-old-records retryable storage cleanup", () => {
  const route = read("app/api/cron/cleanup-old-records/route.ts");
  const helper = read("lib/engine/retention-storage-cleanup.ts");

  it("deletes orphaned FallbackApprovalRecord rows", () => {
    assert.ok(
      route.includes("fallbackApprovalRecord.deleteMany"),
      "must delete FallbackApprovalRecord rows (was orphaned after AiJob delete)",
    );
  });

  it("loads exact TenderFile candidates before touching storage or rows", () => {
    assert.match(helper, /prisma\.tenderFile\.findMany\(/);
    assert.match(helper, /deletedAt: \{ not: null, lt: args\.cutoff \}/);
    assert.match(helper, /deletionStatus: "DELETED"/);
  });

  it("cleans storage before clearing claims and deleting each exact row", () => {
    const storagePos = helper.indexOf("deleteStoredBytes(args.storage");
    const clearPos = helper.indexOf("prisma.tenderFile.updateMany");
    const deletePos = helper.indexOf("prisma.tenderFile.deleteMany");
    assert.ok(storagePos >= 0 && clearPos > storagePos && deletePos > clearPos);
    assert.match(route, /blobsCleaned: tenderFileCleanup\.blobsCleaned/);
    assert.match(route, /tenderFileBlobFailures: tenderFileCleanup\.failures/);
  });

  it("retains failed rows for retry and logs only the error class", () => {
    assert.match(helper, /lastDeletionError: "RETENTION_STORAGE_OR_ROW_PURGE_FAILED"/);
    assert.match(helper, /errorClass: error instanceof Error \? error\.constructor\.name/);
    assert.match(route, /purgeExpiredTenderFiles\(/);
  });

  it("imports the storage adapter and logger through the canonical helper boundary", () => {
    assert.ok(route.includes("getStorageAdapter"), "cron must obtain the storage adapter");
    assert.ok(helper.includes('import { logger }'), "helper must log retry-safe diagnostics");
  });
});

describe("round 12 — pdf2json memory leak fix", () => {
  const src = read("lib/extract-text.ts");

  it("cleans up pdf2json listeners + parser in finally block", () => {
    assert.ok(
      src.includes("parser.removeAllListeners()"),
      "must removeAllListeners in finally (was never cleaned — memory leak)",
    );
    assert.ok(
      src.includes("parser.destroy"),
      "must call parser.destroy in finally (was never destroyed — memory leak)",
    );
    assert.ok(
      src.includes(".finally(()"),
      "must use .finally() to ensure cleanup runs on both success and error paths",
    );
  });
});
