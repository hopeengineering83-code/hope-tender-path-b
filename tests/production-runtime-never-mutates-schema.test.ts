// Production must never mutate schema at request time. Proven by running it.
//
// WHY THIS EXISTS. lib/prisma.ts carries a runtime schema bootstrap that, when
// enabled, issues a large amount of DDL on the first request after a cold
// start: 56 CREATE TABLE IF NOT EXISTS, 83 CREATE INDEX IF NOT EXISTS, 120
// existence-checked ADD COLUMN, and four UNCONDITIONAL statements against
// AiJob — ALTER COLUMN TYPE, SET DEFAULT, ALTER SEQUENCE OWNED BY and a
// setval() computed from MAX(analysisVersion). The last four are the only
// operations in the file that rewrite state on an existing, non-empty table,
// and they are the ones that would race if two deployments warmed at once.
//
// That path is gated: isRuntimeSchemaBootstrapEnabled() returns false when
// NODE_ENV === "production" unless ENABLE_RUNTIME_SCHEMA_BOOTSTRAP is set, so
// on Vercel — which sets NODE_ENV=production for Preview AND Production
// functions alike — bootstrap only verifies connectivity and schema presence.
//
// The existing policy tests assert that by reading the source. Source text is
// not behaviour, and this is the highest-consequence behaviour in the file, so
// this one EXECUTES bootstrap against a recording client and asserts that not
// one mutating statement is issued.
//
// NOTE ON THE UNSET CASE, deliberately pinned rather than changed: under the
// test runner NODE_ENV is undefined, and `!== "production"` therefore enables
// the bootstrap. That is what lets DB-integration tests exercise the real seed
// path, and what makes `npm run dev` work against an empty local database. It
// also means an unrecognised NODE_ENV enables DDL — acceptable only because
// every deployed surface sets NODE_ENV=production. If that ever stops being
// true, the assertion below is where it will be noticed.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { bootstrap } from "../lib/prisma";

type Recorded = { executes: string[]; queries: string[] };

function recordingClient(recorded: Recorded) {
  return {
    $queryRawUnsafe: async (sql: string) => {
      recorded.queries.push(sql);
      // verifySchemaPresent asks for User and Tender and requires both back.
      if (/information_schema\.tables/i.test(sql)) {
        return [{ table_name: "User" }, { table_name: "Tender" }];
      }
      return [{ one: 1 }];
    },
    $executeRawUnsafe: async (sql: string) => {
      recorded.executes.push(sql);
      return 0;
    },
  } as never;
}

async function withNodeEnv<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.NODE_ENV;
  const previousFlag = process.env.ENABLE_RUNTIME_SCHEMA_BOOTSTRAP;
  try {
    if (value === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else (process.env as Record<string, string | undefined>).NODE_ENV = value;
    delete (process.env as Record<string, string | undefined>).ENABLE_RUNTIME_SCHEMA_BOOTSTRAP;
    return await fn();
  } finally {
    if (previous === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else (process.env as Record<string, string | undefined>).NODE_ENV = previous;
    if (previousFlag === undefined) delete (process.env as Record<string, string | undefined>).ENABLE_RUNTIME_SCHEMA_BOOTSTRAP;
    else (process.env as Record<string, string | undefined>).ENABLE_RUNTIME_SCHEMA_BOOTSTRAP = previousFlag;
  }
}

describe("production runtime bootstrap issues no DDL", () => {
  it("executes zero mutating statements when NODE_ENV=production and no opt-in", async () => {
    const recorded: Recorded = { executes: [], queries: [] };
    await withNodeEnv("production", async () => {
      await bootstrap(recordingClient(recorded));
    });

    assert.deepEqual(
      recorded.executes,
      [],
      `production bootstrap must issue no $executeRawUnsafe at all; it issued:\n${recorded.executes.join("\n")}`,
    );

    // And nothing mutating smuggled through the query channel either.
    const mutating = recorded.queries.filter((sql) =>
      /\b(CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|setval|GRANT|REVOKE)\b/i.test(sql),
    );
    assert.deepEqual(
      mutating,
      [],
      `production bootstrap must only read; it issued:\n${mutating.join("\n")}`,
    );
  });

  it("still verifies connectivity and schema presence, so a cold start fails clearly", async () => {
    // The point of keeping ANY production path: a missing table must produce a
    // named error on the first request rather than a timeout deep in a query.
    const recorded: Recorded = { executes: [], queries: [] };
    await withNodeEnv("production", async () => {
      await bootstrap(recordingClient(recorded));
    });
    assert.ok(
      recorded.queries.some((sql) => /SELECT 1/i.test(sql)),
      "connectivity probe must still run",
    );
    assert.ok(
      recorded.queries.some((sql) => /information_schema\.tables/i.test(sql)),
      "schema-presence probe must still run",
    );
  });

  it("names the missing tables and points at the migration tool", async () => {
    const recorded: Recorded = { executes: [], queries: [] };
    const emptyDb = {
      $queryRawUnsafe: async (sql: string) => {
        recorded.queries.push(sql);
        if (/information_schema\.tables/i.test(sql)) return [];
        return [{ one: 1 }];
      },
      $executeRawUnsafe: async (sql: string) => {
        recorded.executes.push(sql);
        return 0;
      },
    } as never;

    await withNodeEnv("production", async () => {
      await assert.rejects(
        () => bootstrap(emptyDb),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /missing table\(s\): User, Tender/);
          assert.match(message, /prisma migrate deploy/);
          return true;
        },
      );
    });

    // An empty production database must be REPORTED, never silently created.
    assert.deepEqual(recorded.executes, []);
  });
});
