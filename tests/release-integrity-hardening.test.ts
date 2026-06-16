import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  getStorageReadiness,
  isDatabaseStorageAllowed,
  resetStorageAdapter,
  resolveStorageProvider,
} from "../lib/storage";

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetStorageAdapter();
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetStorageAdapter();
  }
}

describe("release integrity hardening", () => {
  it("uses the bounded database fallback consistently when Blob is absent", () => {
    withEnv({ NODE_ENV: "production", VERCEL_ENV: "production", BLOB_READ_WRITE_TOKEN: undefined, ALLOW_DB_FILE_STORAGE: undefined }, () => {
      assert.equal(resolveStorageProvider(), "db-base64");
      assert.equal(isDatabaseStorageAllowed(), true);
      const readiness = getStorageReadiness();
      assert.equal(readiness.ready, true);
      assert.equal(readiness.boundedFallback, true);
    });
  });

  it("respects an explicit operator decision to disable database storage", () => {
    withEnv({ NODE_ENV: "production", VERCEL_ENV: "production", BLOB_READ_WRITE_TOKEN: undefined, ALLOW_DB_FILE_STORAGE: "false" }, () => {
      assert.equal(resolveStorageProvider(), "db-base64");
      assert.equal(isDatabaseStorageAllowed(), false);
      assert.equal(getStorageReadiness().ready, false);
    });
  });

  it("prefers Blob when a token is configured", () => {
    withEnv({ NODE_ENV: "production", VERCEL_ENV: "production", BLOB_READ_WRITE_TOKEN: "test-token", ALLOW_DB_FILE_STORAGE: undefined }, () => {
      assert.equal(resolveStorageProvider(), "blob");
      assert.equal(getStorageReadiness().boundedFallback, false);
    });
  });

  it("keeps storage environment policy out of upload routes", () => {
    const standard = readFileSync("app/api/upload/route.ts", "utf8");
    const first = readFileSync("app/api/tenders/upload-first/route.ts", "utf8");
    assert.equal(standard.includes("ALLOW_DB_FILE_STORAGE ="), false);
    assert.equal(first.includes("ALLOW_DB_FILE_STORAGE ="), false);
    assert.match(standard, /handleSecureUpload/);
    assert.match(first, /handleUploadFirstTender/);
  });

  it("scopes generated-document review through the tender owner", () => {
    const route = readFileSync("app/api/tenders/[id]/documents/[docId]/route.ts", "utf8");
    const ownerScopes = route.match(/tender:\s*\{\s*userId:\s*actor\.id\s*\}/g) ?? [];
    assert.ok(ownerScopes.length >= 2, "GET and PUT must both enforce tender ownership");
    assert.match(route, /rateLimitPersistent/);
  });

  it("runs critical schema verification after migrations in production builds", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    const build = pkg.scripts["vercel-build"];
    assert.ok(build.indexOf("migrate-deploy-safe.mjs") >= 0);
    assert.ok(build.indexOf("check-critical-schema.mjs") > build.indexOf("migrate-deploy-safe.mjs"));
  });

  it("requires clean migration-path and integrity checks in CI", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    assert.match(ci, /Validate production migration path/);
    assert.match(ci, /npm run db:check-critical-schema/);
    assert.match(ci, /npm run audit:release-integrity/);
  });
});
