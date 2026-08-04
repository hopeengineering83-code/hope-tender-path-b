import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const service = readFileSync("lib/engine/workflow/durable-deletion.ts", "utf8");
const route = readFileSync("app/api/tenders/[id]/files/[fileId]/route.ts", "utf8");

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
    assert.match(route, /status:\s*deletion\.storageCleanupPending \? 202 : 200/);
    assert.match(route, /storageCleanupPending:\s*deletion\.storageCleanupPending/);
    assert.match(route, /alreadyDeleted:\s*deletion\.alreadyDeleted === true/);
  });
});
