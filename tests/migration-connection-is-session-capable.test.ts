// The production redeploy failed with:
//
//   P1002: timed out acquiring PostgreSQL advisory lock pg_advisory_lock(72707369)
//
// against ep-lucky-tooth-axuc6d8h-POOLER.c-4.us-east-2.aws.neon.tech, while the
// database itself was healthy — 51 migrations applied, none unfinished, no
// missing tables. Nothing was wrong with the schema, and nothing was wrong with
// Neon.
//
// `prisma migrate deploy` serialises itself with a SESSION-scoped advisory
// lock. Neon's pooled endpoint is PgBouncer in transaction pooling mode, where
// consecutive statements may be answered by different backends: the lock is
// taken on one, the next statement lands on another that does not hold it, and
// Prisma waits for a lock it can never observe. The timeout is the symptom; the
// pooled connection is the cause.
//
// The application runtime is deliberately left on the pooled endpoint — pooling
// is correct for it, and serverless functions need it. Only migration needs a
// session that stays put.
//
// These tests pin the resolution rule, and in particular the two ways it could
// go quietly wrong: silently dropping connection parameters (sslmode above all,
// where losing it would downgrade the connection), or rewriting a host it was
// never meant to touch.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveMigrationDatabaseUrl } from "../scripts/resolve-migration-url.mjs";

describe("the migration connection can hold a session lock", () => {
  it("uses the direct endpoint when DATABASE_URL names Neon's pooler", () => {
    const result = resolveMigrationDatabaseUrl({
      DATABASE_URL:
        "postgresql://user:secret@ep-lucky-tooth-axuc6d8h-pooler.c-4.us-east-2.aws.neon.tech:5432/neondb?sslmode=require",
    } as unknown as NodeJS.ProcessEnv);

    const url = new URL(result.url);
    assert.equal(url.hostname, "ep-lucky-tooth-axuc6d8h.c-4.us-east-2.aws.neon.tech");
    assert.ok(!url.hostname.includes("-pooler"), "the pooled host cannot hold the lock");
  });

  it("carries every connection parameter across unchanged", () => {
    // Dropping sslmode here would silently downgrade the migration connection.
    // Only the hostname may differ from what the operator configured.
    const configured =
      "postgresql://user:secret@ep-a-pooler.c-4.us-east-2.aws.neon.tech:5432/neondb?sslmode=require&connect_timeout=15&application_name=migrate";
    const result = resolveMigrationDatabaseUrl({ DATABASE_URL: configured } as unknown as NodeJS.ProcessEnv);

    const before = new URL(configured);
    const after = new URL(result.url);
    assert.equal(after.searchParams.get("sslmode"), "require");
    assert.equal(after.searchParams.get("connect_timeout"), "15");
    assert.equal(after.searchParams.get("application_name"), "migrate");
    assert.equal(after.username, before.username);
    assert.equal(after.password, before.password);
    assert.equal(after.port, before.port);
    assert.equal(after.pathname, before.pathname);
  });

  it("prefers an operator-set DIRECT_URL over deriving one", () => {
    const result = resolveMigrationDatabaseUrl({
      DATABASE_URL: "postgresql://u:p@ep-a-pooler.neon.tech/db",
      DIRECT_URL: "postgresql://u:p@custom-direct.example.com:5432/db",
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(new URL(result.url).hostname, "custom-direct.example.com");
    assert.match(result.source, /DIRECT_URL/);
  });

  it("leaves a non-pooled URL exactly as configured", () => {
    // Local development and CI must be untouched: there is no pooler there, and
    // rewriting a host that has no marker would break both.
    const configured = "postgresql://hope_ci@127.0.0.1:5432/hope_tender_ci?schema=public";
    const result = resolveMigrationDatabaseUrl({ DATABASE_URL: configured } as unknown as NodeJS.ProcessEnv);
    assert.equal(result.url, configured);
  });

  it("does not rewrite a host that merely contains the word pooler", () => {
    // The marker is "-pooler." — a hostname like "pooler-db.example.com" is a
    // different machine, and rewriting it would point migrations somewhere real
    // but wrong, which is worse than failing.
    const configured = "postgresql://u:p@pooler-db.example.com:5432/db";
    const result = resolveMigrationDatabaseUrl({ DATABASE_URL: configured } as unknown as NodeJS.ProcessEnv);
    assert.equal(result.url, configured);
  });

  it("uses a malformed connection string as given rather than guessing", () => {
    const configured = "not-a-url";
    const result = resolveMigrationDatabaseUrl({ DATABASE_URL: configured } as unknown as NodeJS.ProcessEnv);
    assert.equal(result.url, configured);
  });
});

describe("advisory-lock contention is reported as itself", () => {
  const script = readFileSync("scripts/migrate-deploy-safe.mjs", "utf8");

  it("checks for the lock before deciding the database is unreachable", () => {
    // Both arrive as P1002. Checking the reachability codes first is what made
    // the last failure read as "the database is down" and sent the
    // investigation to Neon instead of to the connection mode.
    const lockCheck = script.indexOf("isAdvisoryLockTimeout(message)");
    const reachCheck = script.indexOf("DB_REACH_ERROR_CODES.some");
    assert.ok(lockCheck > 0 && reachCheck > 0, "both checks must exist");
    assert.ok(lockCheck < reachCheck, "the lock check must come first, or it is unreachable");
  });

  it("waits for a concurrent deployment instead of failing the build", () => {
    // Vercel can start concurrent builds; the second holding back is correct
    // behaviour, not an error.
    assert.match(script, /MAX_ADVISORY_LOCK_ATTEMPTS/);
    assert.match(script, /contention between concurrent builds, not a database fault/);
  });

  it("names the pooled-connection cause when it finally gives up", () => {
    assert.match(script, /transaction pooler/);
    assert.match(script, /Set DIRECT_URL/);
  });

  it("still fails closed — no migration check is skipped or softened", () => {
    // The point of this change is to make migrations connect correctly, never
    // to let a broken one through.
    assert.match(script, /FAIL-CLOSED: Final retroactive init verification FAILED/);
    assert.match(script, /FAIL-CLOSED: Critical schema check FAILED/);
    assert.match(script, /Automatic baselining is disabled/);
  });

  it("keeps the runtime on the pooled connection", () => {
    // Only this script switches connection. If the datasource itself were
    // repointed, every serverless function would lose pooling.
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    assert.match(schema, /url\s*=\s*env\("DATABASE_URL"\)/);
    assert.doesNotMatch(schema, /directUrl/, "the runtime datasource must stay pooled");
  });
});
