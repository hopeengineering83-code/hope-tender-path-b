// Regression coverage for two confirmed storage-diagnostics gaps found
// while investigating live Brand Assets / tender upload storage failures:
//
// 1. lib/system-readiness.ts's "file_storage" check re-derived its own
//    readiness condition (requiring ALLOW_DB_FILE_STORAGE === "true"
//    exactly) instead of calling lib/storage.ts's canonical
//    getStorageReadiness(), which treats an *unset* ALLOW_DB_FILE_STORAGE
//    + no Blob token as ready (the default bounded-fallback-allowed
//    state). The two disagreed for the identical configuration -- an
//    operator dashboard false alarm for storage that was actually
//    working. Fixed by delegating to getStorageReadiness().
//
// 2. /api/health (lib/liveness.ts's livenessResponse()) had no storage
//    awareness at all -- an external uptime monitor hitting /api/health
//    would report "healthy" even while every upload was failing because
//    Blob was unconfigured and ALLOW_DB_FILE_STORAGE=false left no
//    working storage provider. Fixed by including getStorageReadiness()
//    in the response and folding it into the ok/status computation the
//    same way AI-provider health already is (degraded, not 503 --
//    the app still serves pages).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const ENV_KEYS = ["NODE_ENV", "VERCEL_ENV", "BLOB_READ_WRITE_TOKEN", "ALLOW_DB_FILE_STORAGE"] as const;
type EnvSnapshot = Record<(typeof ENV_KEYS)[number], string | undefined>;
const mutableEnv = process.env as Record<string, string | undefined>;

function snapshotEnv(): EnvSnapshot {
  return ENV_KEYS.reduce<EnvSnapshot>((acc, key) => {
    acc[key] = process.env[key];
    return acc;
  }, {} as EnvSnapshot);
}
function restoreEnv(snap: EnvSnapshot) {
  for (const key of ENV_KEYS) {
    if (snap[key] === undefined) delete mutableEnv[key];
    else mutableEnv[key] = snap[key];
  }
}

describe("lib/system-readiness.ts — file_storage check agrees with lib/storage.ts", () => {
  it("delegates to getStorageReadiness() instead of re-deriving its own condition", () => {
    const source = readFileSync("lib/system-readiness.ts", "utf8");
    assert.match(source, /import\s*\{\s*getStorageReadiness\s*\}\s*from\s*"\.\/storage"/);
    assert.match(source, /const storageReadiness = getStorageReadiness\(\)/);
    assert.doesNotMatch(source, /durableStorage = storageProvider/, "must not re-derive the readiness condition independently of getStorageReadiness()");
  });

  it("reports the file_storage check as OK for the default bounded-fallback-allowed production state getStorageReadiness() already treats as ready", async () => {
    const snap = snapshotEnv();
    try {
      mutableEnv.NODE_ENV = "production";
      delete mutableEnv.VERCEL_ENV;
      delete mutableEnv.BLOB_READ_WRITE_TOKEN;
      delete mutableEnv.ALLOW_DB_FILE_STORAGE; // unset, not "false" or "true"

      const { getStorageReadiness } = await import("../lib/storage");
      const readiness = getStorageReadiness();
      assert.equal(readiness.provider, "db-base64");
      assert.equal(readiness.ready, true, "precondition: getStorageReadiness() must treat this configuration as ready");

      const { getSystemReadiness } = await import("../lib/system-readiness");
      const result = await getSystemReadiness();
      const check = result.checks.find((c) => c.key === "file_storage");
      assert.ok(check, "must have a file_storage check");
      assert.equal(check!.severity, "OK", "file_storage must not disagree with getStorageReadiness()'s ready:true for this configuration");
    } finally {
      restoreEnv(snap);
    }
  });

  it("reports the file_storage check as CRITICAL when no storage provider works at all (the reported live-failure configuration)", async () => {
    const snap = snapshotEnv();
    try {
      mutableEnv.NODE_ENV = "production";
      delete mutableEnv.VERCEL_ENV;
      delete mutableEnv.BLOB_READ_WRITE_TOKEN;
      mutableEnv.ALLOW_DB_FILE_STORAGE = "false";

      const { getSystemReadiness } = await import("../lib/system-readiness");
      const result = await getSystemReadiness();
      const check = result.checks.find((c) => c.key === "file_storage");
      assert.equal(check?.severity, "CRITICAL");
      assert.match(check!.detail, /db-base64/);
    } finally {
      restoreEnv(snap);
    }
  });
});

describe("/api/health (lib/liveness.ts) — storage awareness", () => {
  const source = readFileSync("lib/liveness.ts", "utf8");

  it("includes storage readiness in the response, sourced from getStorageReadiness()", () => {
    assert.match(source, /import\s*\{\s*getStorageReadiness\s*\}\s*from\s*"\.\/storage"/);
    assert.match(source, /const storageHealth = getStorageReadiness\(\)/);
    assert.match(source, /storage:\s*storageHealth/);
  });

  it("folds storage readiness into ok/status without changing the httpStatus contract", () => {
    assert.match(source, /storageHealth\.ready/);
    // The existing degraded-vs-503 contract (pinned by
    // tests/parallel-uncovered-gap-audit.test.ts) must be unchanged: HTTP
    // status still depends only on allCriticalTablesExist, never on ok.
    assert.match(source, /const httpStatus = allCriticalTablesExist \? 200 : 503/);
  });

  it("never leaks a Blob token or storage URL — the response only carries getStorageReadiness()'s pre-sanitized fields", () => {
    assert.doesNotMatch(source, /BLOB_READ_WRITE_TOKEN/);
    assert.doesNotMatch(source, /blob\.vercel-storage\.com/);
  });
});
