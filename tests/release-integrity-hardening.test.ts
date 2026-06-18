import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

  it("runs critical schema verification after migrations in the production build script", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    const build = pkg.scripts["vercel-build"];
    assert.ok(build.indexOf("migrate-deploy-safe.mjs") >= 0);
    assert.ok(build.indexOf("check-critical-schema.mjs") > build.indexOf("migrate-deploy-safe.mjs"));
  });

  it("keeps Vercel preview builds aligned with preview-safe migration behavior", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { buildCommand: string };
    assert.ok(vercel.buildCommand.indexOf("migrate-deploy-safe.mjs") >= 0);
    assert.equal(vercel.buildCommand.includes("check-critical-schema.mjs"), false);
  });

  it("requires clean migration-path and integrity checks in CI", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    assert.match(ci, /Validate production migration path/);
    assert.match(ci, /npm run db:check-critical-schema/);
    assert.match(ci, /npm run audit:release-integrity/);
  });

  it("migrate-deploy-safe exits gracefully for any migration failure on Vercel preview", () => {
    const script = readFileSync("scripts/migrate-deploy-safe.mjs", "utf8");
    // deploy() must return "preview-error" for any uncategorised error when isVercelPreview=true
    assert.match(script, /isVercelPreview/);
    assert.match(script, /isExplicitProduction/);
    assert.match(script, /isKnownProductionRef/);
    assert.match(script, /hasPullRequestContext/);
    assert.match(script, /preview-error/);
    // preview-error must be caught in deploy() (before the no-history block)
    const previewErrorReturnIdx = script.indexOf('"preview-error"');
    const noHistoryBlockIdx = script.indexOf('if (deployResult === "no-history")');
    assert.ok(previewErrorReturnIdx > 0, 'must return "preview-error" in deploy()');
    assert.ok(noHistoryBlockIdx > previewErrorReturnIdx, '"preview-error" return must appear before no-history block');
    // preview-error handler block must call process.exit(0)
    const previewErrorHandlerIdx = script.indexOf('if (deployResult === "preview-error")');
    assert.ok(previewErrorHandlerIdx > 0, "must have a preview-error handler block");
    const exitZeroAfterHandlerIdx = script.indexOf("process.exit(0)", previewErrorHandlerIdx);
    assert.ok(exitZeroAfterHandlerIdx > previewErrorHandlerIdx, "preview-error block must call process.exit(0)");
    // The no-history block must still have its own preview guard for P3005
    const noHistoryPreviewIdx = script.indexOf("Skipping migration baseline for Vercel preview");
    assert.ok(noHistoryPreviewIdx > 0, "must have no-history preview graceful exit");
    // The !ALLOW_BASELINE hard-fail must still exist for non-preview production
    assert.match(script, /if \(!ALLOW_BASELINE\)/);
  });

  it("migrate-deploy-safe treats missing VERCEL_ENV Vercel previews as non-production only", () => {
    const binDir = mkdtempSync(join(tmpdir(), "fake-prisma-"));
    const fakeNpx = join(binDir, process.platform === "win32" ? "npx.cmd" : "npx");
    writeFileSync(
      fakeNpx,
      process.platform === "win32"
        ? "@echo off\r\necho Prisma schema loaded from prisma/schema.prisma 1>&2\r\necho Error: P3009 1>&2\r\nexit /b 1\r\n"
        : "#!/usr/bin/env bash\necho 'Prisma schema loaded from prisma/schema.prisma' >&2\necho 'Error: P3009' >&2\nexit 1\n",
    );
    chmodSync(fakeNpx, 0o755);

    const baseEnv = {
      ...process.env,
      PATH: `${binDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
      VERCEL: "1",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      PRISMA_BASELINE_EXISTING_DB: undefined,
    };
    const runMigration = (env: NodeJS.ProcessEnv) =>
      spawnSync(process.execPath, ["scripts/migrate-deploy-safe.mjs"], {
        cwd: process.cwd(),
        env: { ...baseEnv, ...env },
        encoding: "utf8",
      });

    const missingEnvFeatureBranch = runMigration({ VERCEL_ENV: undefined, VERCEL_GIT_COMMIT_REF: "codex/verify-pr-768" });
    assert.equal(missingEnvFeatureBranch.status, 0, missingEnvFeatureBranch.stderr);
    assert.match(missingEnvFeatureBranch.stderr, /P3009/);

    const pullRequestPreview = runMigration({ VERCEL_ENV: undefined, VERCEL_GIT_PULL_REQUEST_ID: "768" });
    assert.equal(pullRequestPreview.status, 0, pullRequestPreview.stderr);

    const targetPreview = runMigration({ VERCEL_ENV: undefined, VERCEL_TARGET_ENV: "preview" });
    assert.equal(targetPreview.status, 0, targetPreview.stderr);

    const production = runMigration({ VERCEL_ENV: "production" });
    assert.notEqual(production.status, 0, "production migration failures must remain fatal");

    const targetProduction = runMigration({ VERCEL_ENV: undefined, VERCEL_TARGET_ENV: "production" });
    assert.notEqual(targetProduction.status, 0, "target production migration failures must remain fatal");

    const productionRef = runMigration({ VERCEL_ENV: undefined, VERCEL_GIT_COMMIT_REF: "main" });
    assert.notEqual(productionRef.status, 0, "missing-env main-branch deployments must remain fatal");
  });

  it("migrate-deploy-safe handles retroactive init migration schema conflict without blocking", () => {
    const script = readFileSync("scripts/migrate-deploy-safe.mjs", "utf8");
    // Must define the init migration name
    assert.match(script, /INIT_MIGRATION\s*=\s*["']20260601000000_init["']/);
    // Must detect "already exists" and return schema-conflict (not throw)
    assert.match(script, /already exists/);
    assert.match(script, /schema-conflict/);
    // Must use migrate resolve --applied to mark the init migration
    assert.match(script, /migrate.*resolve.*--applied.*INIT_MIGRATION/s);
    // Must retry deploy after resolving
    const schemaConflictIdx = script.indexOf("schema-conflict");
    const resolveIdx = script.indexOf("resolve", schemaConflictIdx);
    const retryIdx = script.indexOf("deploy()", resolveIdx);
    assert.ok(retryIdx > resolveIdx, "deploy() must be retried after resolving the init migration");
  });
});
