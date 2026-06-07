// Tests for the DB guard added in the TenderMetadataOverride migration PR.
//
// Covers:
// 1. When tenderMetadataOverride.findMany throws P2021, generate route guard
//    falls back to overrides = [] and sets metadataOverrideLookupFailed = true.
// 2. When table is available and returns [], generate route proceeds normally.
// 3. metadata-override GET route returns 503 with DB_MIGRATION_REQUIRED when
//    the table is unavailable (P2021 / P2010 guard).
// 4. Migration SQL file exists at the correct path.
// 5. Migration SQL contains TenderMetadataOverride and the unique index constraint.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Helpers — minimal stubs that mimic the guard logic extracted from the route.
// These unit-test the guard function logic without importing the actual route
// (which requires a real Next.js environment).
// ---------------------------------------------------------------------------

type OverrideRow = { field: string; fieldState: string; overrideValue: string | null };

/**
 * Mirrors the guard block in app/api/tenders/[id]/generate/route.ts.
 * Returns { overrides, metadataOverrideLookupFailed }.
 */
async function runGenerateGuard(
  findMany: () => Promise<OverrideRow[]>,
): Promise<{ overrides: OverrideRow[]; metadataOverrideLookupFailed: boolean }> {
  let overrides: OverrideRow[] = [];
  let metadataOverrideLookupFailed = false;
  try {
    overrides = await findMany();
  } catch (overrideErr) {
    const code = (overrideErr as { code?: string })?.code;
    if (code === "P2021" || code === "P2010") {
      overrides = [];
      metadataOverrideLookupFailed = true;
    } else {
      throw overrideErr;
    }
  }
  return { overrides, metadataOverrideLookupFailed };
}

/**
 * Mirrors the guard block in app/api/tenders/[id]/metadata-override/route.ts
 * for the GET handler. Returns the 503 response body or the real overrides.
 */
async function runMetadataOverrideGetGuard(
  findMany: () => Promise<OverrideRow[]>,
): Promise<{ status: number; body: unknown }> {
  try {
    const overrides = await findMany();
    return { status: 200, body: { ok: true, overrides } };
  } catch (lookupErr) {
    const code = (lookupErr as { code?: string })?.code;
    if (code === "P2021" || code === "P2010") {
      return {
        status: 503,
        body: {
          error: "Database migration required — TenderMetadataOverride table is not yet available.",
          code: "DB_MIGRATION_REQUIRED",
        },
      };
    }
    throw lookupErr;
  }
}

// ---------------------------------------------------------------------------
// Migration file path constant
// ---------------------------------------------------------------------------

const MIGRATION_SQL_PATH = resolve(
  process.cwd(),
  "prisma",
  "migrations",
  "20260608000000_add_tender_metadata_override",
  "migration.sql",
);

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("metadata-override-db-guard", () => {
  // Task E — test 1
  it("generate route: P2021 error → overrides = [], metadataOverrideLookupFailed = true", async () => {
    const p2021Error = Object.assign(new Error("Table does not exist"), { code: "P2021" });
    const findMany = () => Promise.reject<OverrideRow[]>(p2021Error);

    const result = await runGenerateGuard(findMany);

    assert.deepStrictEqual(result.overrides, []);
    assert.strictEqual(result.metadataOverrideLookupFailed, true);
  });

  // Task E — test 1 (P2010 variant)
  it("generate route: P2010 error → overrides = [], metadataOverrideLookupFailed = true", async () => {
    const p2010Error = Object.assign(new Error("Raw query error"), { code: "P2010" });
    const findMany = () => Promise.reject<OverrideRow[]>(p2010Error);

    const result = await runGenerateGuard(findMany);

    assert.deepStrictEqual(result.overrides, []);
    assert.strictEqual(result.metadataOverrideLookupFailed, true);
  });

  // Task E — test 1 (non-P2021 errors must re-throw)
  it("generate route: non-P2021 error is re-thrown", async () => {
    const unknownError = Object.assign(new Error("Connection refused"), { code: "P1001" });
    const findMany = () => Promise.reject<OverrideRow[]>(unknownError);

    await assert.rejects(() => runGenerateGuard(findMany), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.strictEqual((err as { code?: string }).code, "P1001");
      return true;
    });
  });

  // Task E — test 2
  it("generate route: table available and returns [] → proceeds normally, metadataOverrideLookupFailed = false", async () => {
    const findMany = () => Promise.resolve<OverrideRow[]>([]);

    const result = await runGenerateGuard(findMany);

    assert.deepStrictEqual(result.overrides, []);
    assert.strictEqual(result.metadataOverrideLookupFailed, false);
  });

  // Task E — test 2 (with real rows)
  it("generate route: table available and returns rows → overrides are passed through", async () => {
    const rows: OverrideRow[] = [
      { field: "clientName", fieldState: "USER_EDITED", overrideValue: "Ministry of Works" },
    ];
    const findMany = () => Promise.resolve(rows);

    const result = await runGenerateGuard(findMany);

    assert.strictEqual(result.overrides.length, 1);
    assert.strictEqual(result.overrides[0].field, "clientName");
    assert.strictEqual(result.metadataOverrideLookupFailed, false);
  });

  // Task E — test 3 (GET handler, P2021)
  it("metadata-override GET: P2021 → 503 with DB_MIGRATION_REQUIRED", async () => {
    const p2021Error = Object.assign(new Error("Table does not exist"), { code: "P2021" });
    const findMany = () => Promise.reject<OverrideRow[]>(p2021Error);

    const result = await runMetadataOverrideGetGuard(findMany);

    assert.strictEqual(result.status, 503);
    const body = result.body as { error: string; code: string };
    assert.strictEqual(body.code, "DB_MIGRATION_REQUIRED");
    assert.ok(body.error.includes("Database migration required"));
  });

  // Task E — test 3 (GET handler, P2010 variant)
  it("metadata-override GET: P2010 → 503 with DB_MIGRATION_REQUIRED", async () => {
    const p2010Error = Object.assign(new Error("Raw query error"), { code: "P2010" });
    const findMany = () => Promise.reject<OverrideRow[]>(p2010Error);

    const result = await runMetadataOverrideGetGuard(findMany);

    assert.strictEqual(result.status, 503);
    const body = result.body as { error: string; code: string };
    assert.strictEqual(body.code, "DB_MIGRATION_REQUIRED");
  });

  // Task E — test 3 (GET handler: non-P2021 re-throws)
  it("metadata-override GET: non-P2021 error is re-thrown", async () => {
    const unknownError = Object.assign(new Error("Timeout"), { code: "P1002" });
    const findMany = () => Promise.reject<OverrideRow[]>(unknownError);

    await assert.rejects(() => runMetadataOverrideGetGuard(findMany), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.strictEqual((err as { code?: string }).code, "P1002");
      return true;
    });
  });

  // Task E — test 3 (GET handler: success)
  it("metadata-override GET: table available → 200 with overrides", async () => {
    const rows: OverrideRow[] = [];
    const findMany = () => Promise.resolve(rows);

    const result = await runMetadataOverrideGetGuard(findMany);

    assert.strictEqual(result.status, 200);
    const body = result.body as { ok: boolean; overrides: OverrideRow[] };
    assert.strictEqual(body.ok, true);
    assert.deepStrictEqual(body.overrides, []);
  });

  // Task E — test 4
  it("migration SQL file exists at the correct path", () => {
    assert.ok(
      existsSync(MIGRATION_SQL_PATH),
      `Migration file not found at: ${MIGRATION_SQL_PATH}`,
    );
  });

  // Task E — test 5
  it("migration SQL contains TenderMetadataOverride table definition", () => {
    const sql = readFileSync(MIGRATION_SQL_PATH, "utf-8");
    assert.ok(
      sql.includes("TenderMetadataOverride"),
      "Migration SQL does not mention TenderMetadataOverride",
    );
  });

  // Task E — test 5 (unique constraint)
  it("migration SQL contains the tenderId_field_key unique constraint", () => {
    const sql = readFileSync(MIGRATION_SQL_PATH, "utf-8");
    assert.ok(
      sql.includes("TenderMetadataOverride_tenderId_field_key"),
      "Migration SQL does not include the tenderId_field_key unique index",
    );
  });

  // Task E — test 5 (IF NOT EXISTS safety)
  it("migration SQL uses IF NOT EXISTS for table and index creation", () => {
    const sql = readFileSync(MIGRATION_SQL_PATH, "utf-8");
    assert.ok(
      sql.includes("CREATE TABLE IF NOT EXISTS"),
      "Migration SQL must use CREATE TABLE IF NOT EXISTS",
    );
    assert.ok(
      sql.includes("CREATE UNIQUE INDEX IF NOT EXISTS"),
      "Migration SQL must use CREATE UNIQUE INDEX IF NOT EXISTS",
    );
  });
});
