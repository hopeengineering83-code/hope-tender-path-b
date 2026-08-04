import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const service = readFileSync("lib/engine/workflow/durable-deletion.ts", "utf8");
const fileRoute = readFileSync("app/api/tenders/[id]/files/[fileId]/route.ts", "utf8");
const uploadRoute = readFileSync("app/api/upload/route.ts", "utf8");
const uploadRecovery = readFileSync("lib/tender-upload-idempotent-recovery.ts", "utf8");

describe("durable tender-file deletion recovery", () => {
  it("accepts ACTIVE and PENDING_DELETE rows and is idempotent for DELETED", () => {
    assert.match(service, /file\.deletionStatus === "DELETED"/);
    assert.match(service, /\['ACTIVE', 'PENDING_DELETE'\]/);
    assert.doesNotMatch(service, /deletionStatus:\s*"ACTIVE"[\s\S]*tender:\s*\{ userId \}/);
  });

  it("releases only the legacy dedup key when a source leaves active use", () => {
    assert.match(service, /deletionStatus:\s*"PENDING_DELETE"/);
    assert.match(service, /contentHash:\s*null/);
    assert.match(service, /contentSha256 remains preserved/);
    assert.doesNotMatch(service, /contentSha256:\s*null/);
  });

  it("retries external storage deletion and preserves a recoverable pending row", () => {
    assert.match(service, /STORAGE_DELETE_ATTEMPTS = 3/);
    assert.match(service, /deleteStoredFileWithRetry/);
    assert.match(service, /lastDeletionError:\s*"STORAGE_DELETION_PENDING"/);
    assert.match(service, /storageCleanupPending:\s*true/);
    assert.doesNotMatch(service, /deletionStatus:\s*"ACTIVE",[\s\S]*STORAGE_DELETION_FAILED/);
  });

  it("returns controlled HTTP 202 for pending cleanup instead of a false 502", () => {
    assert.match(fileRoute, /status:\s*deletion\.storageCleanupPending \? 202 : 200/);
    assert.match(fileRoute, /storageCleanupPending:\s*deletion\.storageCleanupPending/);
    assert.match(fileRoute, /alreadyDeleted:\s*deletion\.alreadyDeleted === true/);
  });
});

describe("legacy re-upload recovery", () => {
  it("releases only non-active legacy dedup keys and preserves SHA-256 evidence", () => {
    assert.match(uploadRecovery, /deletionStatus:\s*\{ in: \["PENDING_DELETE", "DELETED"\] \}/);
    assert.match(uploadRecovery, /data: \{ contentHash: null \}/);
    assert.doesNotMatch(uploadRecovery, /contentSha256:\s*null/);
  });

  it("does not create rows, store bytes, or enqueue jobs in the recovery helper", () => {
    assert.doesNotMatch(uploadRecovery, /getStorageAdapter|putFile\(/);
    assert.doesNotMatch(uploadRecovery, /tenderFile\.(?:create|upsert)/);
    assert.doesNotMatch(uploadRecovery, /enqueueTenderFileExtractionJob|enqueueJob/);
    assert.doesNotMatch(uploadRecovery, /NextResponse/);
  });

  it("retries through the canonical secure-upload handler exactly once", () => {
    assert.match(uploadRoute, /prepareIdempotentTenderUploadRetry/);
    assert.equal((uploadRoute.match(/handleSecureUpload\(/g) ?? []).length, 2);
    assert.match(uploadRoute, /if \(prepared\) response = await handleSecureUpload\(canonicalRetryRequest\)/);
  });
});
