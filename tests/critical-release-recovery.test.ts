import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("critical release recovery controls", () => {
  it("never treats an arbitrary preview migration failure as success", () => {
    const script = read("scripts/migrate-deploy-safe.mjs");
    assert.doesNotMatch(script, /return\s+["']preview-error["']/);
    assert.doesNotMatch(script, /deployResult\s*===\s*["']preview-error["']/);
    assert.doesNotMatch(script, /any migration error on Vercel preview is non-fatal/i);
  });

  it("repairs only the known failed init migration after a schema diff passes", () => {
    const script = read("scripts/migrate-deploy-safe.mjs");
    assert.match(script, /const INIT_MIGRATION = ["']20260601000000_init["']/);
    assert.match(script, /message\.includes\(["']P3009["']\)\s*&&\s*message\.includes\(INIT_MIGRATION\)/);
    assert.match(script, /migrate["'],\s*["']diff/);
    assert.match(script, /--from-schema-datasource/);
    assert.match(script, /--to-schema-datamodel/);
    assert.match(script, /--exit-code/);
    assert.doesNotMatch(script, /--from-url/);

    const verifyIndex = script.indexOf("schemaMatchesCurrentPrismaModel()");
    const rolledBackIndex = script.indexOf('"--rolled-back", INIT_MIGRATION');
    const appliedIndex = script.indexOf('"--applied", INIT_MIGRATION');
    assert.ok(verifyIndex >= 0, "schema verification helper must exist");
    assert.ok(rolledBackIndex > verifyIndex, "schema verification must precede rollback resolution");
    assert.ok(appliedIndex > rolledBackIndex, "migration is marked applied only after failed state is resolved");
  });

  it("does not expose DATABASE_URL as a command-line argument", () => {
    const script = read("scripts/migrate-deploy-safe.mjs");
    assert.doesNotMatch(script, /const databaseUrl\s*=\s*process\.env\.DATABASE_URL/);
    assert.doesNotMatch(script, /--from-url/);
    assert.match(script, /--from-schema-datasource/);
    assert.match(script, /Database schema verification failed without changing migration history/);
  });

  it("redacts the configured database URL from captured Prisma output", () => {
    const script = read("scripts/migrate-deploy-safe.mjs");
    assert.match(script, /function redactSensitive/);
    assert.match(script, /configuredDatabaseUrl/);
    assert.match(script, /\[REDACTED_DATABASE_URL\]/);
    assert.match(script, /target\.write\(redactSensitive\(value\)\)/);
    assert.match(script, /return redactSensitive\(`/);
  });

  it("keeps failed-init repair and no-history baseline mutually exclusive", () => {
    const script = read("scripts/migrate-deploy-safe.mjs");
    assert.match(script, /const initialResult = deploy\(\)/);
    assert.match(script, /if \(initialResult === "failed-init"\)/);
    assert.match(script, /else if \(initialResult === "no-history"\)/);
    assert.doesNotMatch(script, /deployResult\s*=\s*deploy\(\)/);
    assert.match(script, /still failed after resolving/);
    assert.match(script, /still failed after controlled baseline/);
  });

  it("does not reapply migration SQL outside Prisma migration history", () => {
    const script = read("scripts/migrate-deploy-safe.mjs");
    assert.doesNotMatch(script, /prisma\(\["db",\s*"execute"/);
    assert.doesNotMatch(script, /Reapplying idempotent database guard definitions/);
  });

  it("requires schema verification before an explicitly authorized baseline", () => {
    const script = read("scripts/migrate-deploy-safe.mjs");
    const baselineFunction = script.slice(script.indexOf("function baselineExistingDatabase"));
    assert.match(baselineFunction, /if \(!ALLOW_BASELINE\)/);
    assert.match(baselineFunction, /schemaMatchesCurrentPrismaModel\(\)/);
    assert.match(baselineFunction, /Refusing controlled baseline/);
  });

  it("keeps the reconciler manual and out of lifecycle commands", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    for (const name of ["postinstall", "build", "vercel-build", "typecheck", "lint", "test", "test:integration"]) {
      assert.ok(pkg.scripts[name], `${name} script must exist`);
      assert.doesNotMatch(pkg.scripts[name], /reconcile-gap-closure/);
    }
    assert.match(pkg.scripts["reconcile:ai"], /reconcile-gap-closure/);
  });

  it("runs CI on migration-built schema and checks for source mutation", () => {
    const ci = read(".github/workflows/ci.yml");
    assert.doesNotMatch(ci, /prisma db push/);
    assert.doesNotMatch(ci, /prisma db execute/);
    assert.match(ci, /npx prisma migrate deploy/);
    assert.match(ci, /Verify credential-safe zero-drift schema comparison/);
    assert.match(ci, /--from-schema-datasource/);
    assert.doesNotMatch(ci, /--from-url/);
    assert.match(ci, /Verify migration idempotency/);
    assert.match(ci, /git diff --exit-code/);
    assert.match(ci, /integration\/production-engine-2026-06/);
    assert.match(ci, /release\/production-engine-2026-06/);
  });

  it("uses one package-owned Vercel build pipeline", () => {
    const vercel = JSON.parse(read("vercel.json")) as { buildCommand?: string };
    assert.equal(vercel.buildCommand, "npm run vercel-build");
  });
});
