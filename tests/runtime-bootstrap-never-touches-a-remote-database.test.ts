// ─── The legacy runtime bootstrap never touches a remote database ───────────
//
// Three successive Preview Neon databases were found in the same state:
//
//   BASE TABLES in public: 54      _prisma_migrations present: false
//   ROW COUNTS: 4 Role, 0 everything else
//   User columns: 7  deletedAt=false deletedBy=false
//   prisma migrate status: 53 migrations have not yet been applied
//   drift statements: 431
//
// and each time the Preview runtime reached it and failed login with P2022
// ("The column User.deletedAt does not exist"). That schema is lib/prisma.ts's
// legacy CREATE TABLE IF NOT EXISTS bootstrap, which ran for ANY process with
// NODE_ENV !== "production" against WHATEVER DATABASE_URL it was given. Once
// it has run, `prisma migrate deploy` refuses the database with P3005 and the
// only way back is a gated DROP SCHEMA.
//
// The first-run convenience (`npm run dev` against a local Postgres) is kept.
// A remote database now needs the same explicit opt-in production always did.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isLocalDatabaseUrl, isRuntimeSchemaBootstrapEnabled } from "../lib/prisma";

const env = process.env as Record<string, string | undefined>;

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, env[k]]));
  try {
    for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete env[k]; else env[k] = v; }
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete env[k]; else env[k] = v; }
  }
}

const NEON = "postgresql://u:p@ep-example-123456.us-east-2.aws.neon.tech/neondb?sslmode=require";
const LOCAL = "postgresql://hope_ci:hope_ci@127.0.0.1:5432/hope_tender_ci?schema=public";

describe("which databases count as local", () => {
  it("accepts loopback hosts", () => {
    for (const url of [LOCAL, "postgresql://a:b@localhost/db", "postgresql://a:b@[::1]:5432/db"]) {
      assert.equal(isLocalDatabaseUrl(url), true, url);
    }
  });
  it("rejects a remote managed database", () => {
    assert.equal(isLocalDatabaseUrl(NEON), false);
    assert.equal(isLocalDatabaseUrl("postgresql://a:b@db.internal.example.com:5432/app"), false);
  });
  it("refuses to guess about an unparseable url", () => {
    assert.equal(isLocalDatabaseUrl("not a url"), false);
  });
});

describe("the runtime bootstrap policy", () => {
  it("does NOT bootstrap a remote database outside production -- the observed failure", () => {
    const enabled = withEnv({ NODE_ENV: "development", DATABASE_URL: NEON, ENABLE_RUNTIME_SCHEMA_BOOTSTRAP: undefined }, isRuntimeSchemaBootstrapEnabled);
    assert.equal(enabled, false);
  });
  it("does NOT bootstrap a remote database when NODE_ENV is unset (scripts, CI jobs)", () => {
    const enabled = withEnv({ NODE_ENV: undefined, DATABASE_URL: NEON, ENABLE_RUNTIME_SCHEMA_BOOTSTRAP: undefined }, isRuntimeSchemaBootstrapEnabled);
    assert.equal(enabled, false);
  });
  it("still bootstraps a local database in development", () => {
    const enabled = withEnv({ NODE_ENV: "development", DATABASE_URL: LOCAL, ENABLE_RUNTIME_SCHEMA_BOOTSTRAP: undefined }, isRuntimeSchemaBootstrapEnabled);
    assert.equal(enabled, true);
  });
  it("never bootstraps in production without the explicit opt-in", () => {
    for (const url of [NEON, LOCAL]) {
      const enabled = withEnv({ NODE_ENV: "production", DATABASE_URL: url, ENABLE_RUNTIME_SCHEMA_BOOTSTRAP: undefined }, isRuntimeSchemaBootstrapEnabled);
      assert.equal(enabled, false, url);
    }
  });
  it("honours the explicit opt-in anywhere", () => {
    const enabled = withEnv({ NODE_ENV: "development", DATABASE_URL: NEON, ENABLE_RUNTIME_SCHEMA_BOOTSTRAP: "true" }, isRuntimeSchemaBootstrapEnabled);
    assert.equal(enabled, true);
  });
});
