import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("release integrity upgrade", () => {
  it("keeps install, build, checks, and tests non-mutating", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    for (const name of ["postinstall", "build", "vercel-build", "typecheck", "lint", "test", "test:integration"]) {
      assert.ok(pkg.scripts[name], `${name} must exist`);
      assert.doesNotMatch(pkg.scripts[name], /reconcile-gap-closure/);
    }
    assert.match(pkg.scripts["reconcile:ai"], /reconcile-gap-closure/);
  });

  it("uses one package-owned Vercel build command", () => {
    const vercel = JSON.parse(read("vercel.json")) as { buildCommand?: string; installCommand?: string };
    assert.equal(vercel.buildCommand, "npm run vercel-build");
    assert.equal(vercel.installCommand, "npm ci");
  });

  it("limits automatic migration recovery to the exact failed init with strict preconditions", () => {
    const migration = read("scripts/migrate-deploy-safe.mjs");
    assert.match(migration, /INIT_MIGRATION = "20260601000000_init"/);
    assert.match(migration, /P3009/);
    assert.match(migration, /--expect-failed-init/);
    assert.match(migration, /--require-schema/);
    assert.match(migration, /verifyFailedInitPreconditions/);
    assert.match(migration, /verify-retroactive-init\.mjs/);
    assert.match(migration, /check-critical-schema\.mjs/);
    assert.match(migration, /ALLOW_PREVIEW_DB_MIGRATIONS/);
    assert.match(migration, /Automatic baselining is disabled/);
    assert.doesNotMatch(migration, /PRISMA_BASELINE_EXISTING_DB/);
    assert.doesNotMatch(migration, /\["db", "execute"/);

    // Ensure recovery is blocked if preconditions fail (no swallowing of errors in recovery path)
    assert.doesNotMatch(migration, /catch.*proceeding with recovery attempt/);
    assert.match(migration, /throw new Error\("Safety check failed/);
  });

  it("verifies the init checksum, structure, and migration state", () => {
    const verifier = read("scripts/verify-retroactive-init.mjs");
    assert.match(verifier, /createHash\("sha256"\)/);
    assert.match(verifier, /schemaFailures\.push\(`Missing initialization table/);
    assert.match(verifier, /schemaFailures\.push\(`Missing initialization column/);
    assert.match(verifier, /schemaFailures\.push\(`Missing initialization index/);
    assert.match(verifier, /schemaFailures\.push\(`Missing initialization constraint/);
    assert.match(verifier, /historyFailures\.push\(`Expected exactly one unfinished migration/);
    assert.match(verifier, /historyFailures\.push\(`No completed, checksum-matching/);
  });

  it("supports schema validation even when expecting failed init migration via --require-schema", () => {
    const verifier = read("scripts/verify-retroactive-init.mjs");
    assert.match(verifier, /if \(!expectFailedInit \|\| requireSchema\)/);
    // Ensure it still checks migration history in failed state
    assert.match(verifier, /unfinished\.length !== 1/);
    assert.match(verifier, /Checksum mismatch for unfinished/);
  });

  it("constructs the CI database only through migrations", () => {
    const ci = read(".github/workflows/ci.yml");
    assert.doesNotMatch(ci, /prisma db push/);
    assert.doesNotMatch(ci, /prisma db execute/);
    assert.ok((ci.match(/npx prisma migrate deploy/g) ?? []).length >= 2);
    assert.match(ci, /npm run db:check-critical-schema/);
    assert.match(ci, /npm run db:verify-retroactive-init/);
    assert.ok((ci.match(/git diff --exit-code/g) ?? []).length >= 3);
  });

  it("runs real two-user supplied-ID isolation fixtures", () => {
    const seed = read("scripts/seed-e2e-user.mjs");
    const isolation = read("e2e/cross-user-isolation.spec.ts");
    assert.match(seed, /E2E_SEED_ALLOWED/);
    assert.match(seed, /E2E seed is disabled in production/);
    assert.match(seed, /Primary Owner Fixture/);
    assert.match(seed, /Secondary Owner Private Tender/);
    assert.match(seed, /33333333-3333-4333-8333-333333333333/);
    assert.match(seed, /44444444-4444-4444-8444-444444444444/);
    assert.match(isolation, /SECONDARY_DOCUMENT_ID/);
    assert.match(isolation, /SECONDARY_FILE_ID/);
    // attach-original route deleted — no longer in release-integrity isolation list
    assert.match(isolation, /finalize-pdf/);
    assert.match(isolation, /files\/\$\{SECONDARY_FILE_ID\}/);
    assert.match(isolation, /Secondary Owner Private Tender/);
    assert.match(isolation, /deletionStatus: "ACTIVE"/);
  });

  it("verifies deployment health, critical tables, and exact release SHA", () => {
    const verifier = read("scripts/verify-deployment.mjs");
    assert.match(verifier, /EXPECTED_RELEASE_SHA/);
    assert.match(verifier, /health\.status !== "healthy"/);
    assert.match(verifier, /health\.release !== expectedRelease/);
    for (const table of ["RateLimitBucket", "PasswordResetToken", "SubmissionPlanState", "AiAnalyzeChunk", "AiJob"]) {
      assert.match(verifier, new RegExp(table));
    }
  });

  it("includes specific missing TenderFile columns in critical schema check", () => {
    const check = read("scripts/critical-schema-contract.mjs");
    assert.match(check, /"lastDeletionError"/);
    assert.match(check, /"deletedAt"/);
  });
});
