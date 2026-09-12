// The bootstrap must actually RUN on an empty database.
//
// tests/bootstrap-schema-coverage.test.ts compares the set of table names
// created by migrations against the set of `CREATE TABLE IF NOT EXISTS` names
// in lib/prisma.ts. That is a set comparison over source text: it never
// executes the bootstrap, so it is blind to ordering. It passed for the whole
// life of a bootstrap that could not complete.
//
// The defect it missed: the DocumentReview / DocumentComment drift repair sat
// roughly 270 lines ABOVE the CREATE TABLE statements for those tables.
// ensureColumn issues ALTER TABLE, so against a genuinely empty database the
// first call threw
//
//     relation "DocumentReview" does not exist
//
// and aborted the entire bootstrap. It went unnoticed because every database
// it had ever run against was built by `prisma migrate deploy` first, which
// creates the tables — that is, the one scenario bootstrap exists to serve was
// the only one it never faced.
//
// This test runs the real bootstrap against a real empty PostgreSQL schema.
// Any statement that depends on an object created later fails here.

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { PrismaClient } from "@prisma/client";

import { bootstrap } from "../lib/prisma";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

const SCHEMA = `bootstrap_probe_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

function urlWithSchema(schema: string): string {
  const raw = process.env.DATABASE_URL ?? "";
  const [base, query = ""] = raw.split("?");
  const params = new URLSearchParams(query);
  params.set("schema", schema);
  return `${base}?${params.toString()}`;
}

let admin: PrismaClient;
let probe: PrismaClient;

describe("bootstrap on a genuinely empty schema — real PostgreSQL", () => {
  before(async () => {
    admin = new PrismaClient();
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${SCHEMA}"`);
    probe = new PrismaClient({ datasources: { db: { url: urlWithSchema(SCHEMA) } } });
  });

  after(async () => {
    await probe?.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await admin.$disconnect();
  });

  it("completes without throwing", async () => {
    // The whole point. A statement referencing an object created later in the
    // same function throws here and nowhere else in the suite.
    await bootstrap(probe);
  });

  it("creates the tables the drift repair then alters", async () => {
    // These two are what the ordering bug tripped over: the repair ALTERed
    // them before they existed.
    for (const table of ["DocumentReview", "DocumentComment"]) {
      const rows = await probe.$queryRawUnsafe<Array<{ t: string | null }>>(
        `SELECT to_regclass('"${SCHEMA}"."${table}"')::text AS t`,
      );
      assert.equal(typeof rows[0].t, "string", `${table} must exist after bootstrap`);
    }
  });

  it("creates PlanBStaging with the schema's updatedAt default", async () => {
    // PlanBStaging is the newest table and was missing from bootstrap
    // entirely; its migration also created updatedAt with no default, which
    // failed the CI zero-drift gate. Both halves are pinned here.
    const rows = await probe.$queryRawUnsafe<Array<{ column_default: string | null }>>(
      `SELECT column_default FROM information_schema.columns
       WHERE table_schema = '${SCHEMA}' AND table_name = 'PlanBStaging' AND column_name = 'updatedAt'`,
    );
    assert.equal(rows.length, 1, "PlanBStaging.updatedAt must exist after bootstrap");
    assert.match(rows[0].column_default ?? "", /now\(\)/i, "updatedAt must carry a database-level default");
  });

  it("is idempotent — running it twice on the same schema still succeeds", async () => {
    await bootstrap(probe);
  });
});
