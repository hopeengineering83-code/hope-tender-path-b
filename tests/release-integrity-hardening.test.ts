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

  it("runs critical schema verification inside the safe migration command used by production builds", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    const build = pkg.scripts["vercel-build"];
    assert.match(build, /migrate-deploy-safe\.mjs/);

    const migrationScript = readFileSync("scripts/migrate-deploy-safe.mjs", "utf8");
    assert.match(migrationScript, /scripts\/check-critical-schema\.mjs/);
    assert.match(migrationScript, /REQUIRE_MIGRATION_HISTORY:\s*"true"/);
  });

  it("requires migration-path, schema and integrity checks in CI", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    assert.match(ci, /Deploy the complete migration history/);
    assert.match(ci, /Verify critical migrated schema/);
    assert.match(ci, /Verify migration idempotency/);
    assert.match(ci, /npm run db:check-critical-schema/);
    assert.match(ci, /npm run audit:release-integrity/);
    assert.doesNotMatch(ci, /prisma db push/);
  });

  it("keeps preview migrations disabled unless an isolated preview database is explicitly authorized", () => {
    const script = readFileSync("scripts/migrate-deploy-safe.mjs", "utf8");
    assert.match(script, /ALLOW_PREVIEW_DB_MIGRATIONS/);
    assert.match(script, /isVercelPreview\s*&&\s*!allowPreviewMigrations/);
    assert.match(script, /build-only and is not database-verified/);
    assert.doesNotMatch(script, /return\s+["']preview-error["']/);
    assert.doesNotMatch(script, /deployResult\s*===\s*["']preview-error["']/);
  });

  it("repairs the known retroactive init failure only after full schema verification", () => {
    const script = readFileSync("scripts/migrate-deploy-safe.mjs", "utf8");
    assert.match(script, /INIT_MIGRATION\s*=\s*["']20260601000000_init["']/);
    assert.match(script, /message\.includes\(["']P3009["']\)\s*&&\s*message\.includes\(INIT_MIGRATION\)/);
    assert.match(script, /migrate["'],\s*["']diff/);
    assert.match(script, /--from-schema-datasource/);
    assert.doesNotMatch(script, /--from-url/);
    assert.match(script, /--to-schema-datamodel/);
    assert.match(script, /--exit-code/);
    assert.match(script, /"--rolled-back", INIT_MIGRATION/);
    assert.match(script, /"--applied", INIT_MIGRATION/);

    const verifyIdx = script.indexOf("schemaMatchesCurrentPrismaModel()");
    const rolledBackIdx = script.indexOf('"--rolled-back", INIT_MIGRATION');
    const appliedIdx = script.indexOf('"--applied", INIT_MIGRATION');
    const retryIdx = script.indexOf("deploy();", appliedIdx);
    assert.ok(verifyIdx >= 0, "schema verification helper must exist");
    assert.ok(rolledBackIdx > verifyIdx, "schema verification must precede migration-history repair");
    assert.ok(appliedIdx > rolledBackIdx, "failed state must be resolved before marking migration applied");
    assert.ok(retryIdx > appliedIdx, "migrate deploy must be retried after safe repair");
  });
});
