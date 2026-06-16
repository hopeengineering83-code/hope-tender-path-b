// Ensures lib/prisma.ts bootstrap CREATE TABLE statements cover every table
// added by Prisma migrations. When a migration adds a new table it MUST also
// be added to the bootstrap so fresh databases work without running migrations.
//
// Without this guard, new tables (like RateLimitBucket) end up missing from
// fresh bootstrap databases, causing 42P01 errors in production.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIGRATIONS_DIR = join(ROOT, "prisma", "migrations");
const BOOTSTRAP_PATH = join(ROOT, "lib", "prisma.ts");

function extractCreatedTables(sql: string): string[] {
  const matches = sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"([^"]+)"/gi);
  return [...matches].map((m) => m[1]);
}

function migrationSqlFiles(): { name: string; sql: string }[] {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR)
    .filter((d) => existsSync(join(MIGRATIONS_DIR, d, "migration.sql")))
    .map((d) => ({
      name: d,
      sql: readFileSync(join(MIGRATIONS_DIR, d, "migration.sql"), "utf8"),
    }));
}

// Tables that are intentionally managed only by migrations (not bootstrap),
// e.g. because they require Postgres extensions or complex DDL that the
// bootstrap doesn't support. Add to this list only with a clear reason.
const BOOTSTRAP_EXEMPT: Set<string> = new Set([
  // none currently — every table should be in bootstrap
]);

describe("Bootstrap schema coverage", () => {
  const bootstrapSource = readFileSync(BOOTSTRAP_PATH, "utf8");
  const bootstrapTables = new Set(extractCreatedTables(bootstrapSource));

  const migrations = migrationSqlFiles();
  const allMigrationTables = new Set<string>();
  for (const { sql } of migrations) {
    for (const t of extractCreatedTables(sql)) {
      allMigrationTables.add(t);
    }
  }

  it("lib/prisma.ts bootstrap covers all tables created by migrations", () => {
    const missing = [...allMigrationTables].filter(
      (t) => !bootstrapTables.has(t) && !BOOTSTRAP_EXEMPT.has(t),
    );
    assert.deepEqual(
      missing,
      [],
      `These tables are created by migrations but MISSING from lib/prisma.ts bootstrap:\n` +
        missing.map((t) => `  - ${t}`).join("\n") +
        `\n\nAdd CREATE TABLE IF NOT EXISTS "${missing[0]}" blocks to lib/prisma.ts ` +
        `so fresh databases work without running 'prisma migrate deploy'.`,
    );
  });

  it("bootstrap covers the critical security tables", () => {
    for (const table of ["RateLimitBucket", "PasswordResetToken"]) {
      assert.ok(
        bootstrapTables.has(table),
        `lib/prisma.ts bootstrap is missing CREATE TABLE for "${table}" — upload and auth will fail on fresh databases`,
      );
    }
  });
});
