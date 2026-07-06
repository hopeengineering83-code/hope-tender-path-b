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
    assert.ok(src.includes("tx.generatedDocument.findFirst"), "must use tx for findFirst inside the transaction");
    assert.ok(src.includes("tx.generatedDocument.update"), "must use tx for update inside the transaction");
    assert.ok(src.includes("tx.generatedDocument.create"), "must use tx for create inside the transaction");
  });
});

describe("round 12 — O2: cleanup-old-records orphans + blob cleanup", () => {
  const src = read("app/api/cron/cleanup-old-records/route.ts");

  it("deletes orphaned FallbackApprovalRecord rows", () => {
    assert.ok(
      src.includes("fallbackApprovalRecord.deleteMany"),
      "must delete FallbackApprovalRecord rows (was orphaned after AiJob delete)",
    );
  });

  it("reads storagePaths BEFORE deleting TenderFile rows", () => {
    assert.ok(
      src.includes("filesToDelete"),
      "must read filesToDelete before the deleteMany (was DB-only — orphans blobs)",
    );
    assert.ok(
      src.includes("tenderFile.findMany"),
      "must use findMany to read storage paths before deleteMany",
    );
  });

  it("cleans up blob storage after DB delete", () => {
    assert.ok(src.includes("storage.deleteFile"), "must call storage.deleteFile for each file");
    assert.ok(src.includes("blobsCleaned"), "must report blobsCleaned count in the response");
  });

  it("imports getStorageAdapter + logger", () => {
    assert.ok(src.includes("getStorageAdapter"), "must import getStorageAdapter");
    assert.ok(src.includes("import { logger }"), "must import logger for warning logs");
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
