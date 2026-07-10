// Unit tests for the Database Recovery status module.
//
// These use an in-memory mock PrismaClient — no real DB required. They assert
// the sanitization contract (no secrets/records/content leak) and the core
// status logic (initialization-required, invalid restored settings, missing
// branding assets, dry-run repair preview).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { getDbRecoveryStatus, buildRepairPreview, REQUIRED_TABLES } from "../lib/db-recovery/status";

type MockOpts = {
  reachable?: boolean;
  missingTables?: string[];
  company?: { id: string; settings: Record<string, unknown> | null } | null;
  assets?: Array<{ assetType: string; isActive: boolean }>;
};

function makeMockPrisma(opts: MockOpts) {
  const present = new Set(REQUIRED_TABLES.filter((t) => !(opts.missingTables ?? []).includes(t)));
  return {
    $queryRawUnsafe: async (sql: string, arg?: string) => {
      if (!opts.reachable) throw new Error("ECONNREFUSED");
      if (sql.includes("information_schema")) return [{ exists: present.has(arg as string) }];
      return [{ "?column?": 1 }];
    },
    appSettings: {
      findFirst: async () => (opts.company?.settings ?? null),
      count: async () => (opts.company?.settings ? 1 : 0),
    },
    company: {
      findUnique: async () => opts.company ?? null,
      count: async () => (opts.company ? 1 : 0),
    },
    companyAsset: {
      findMany: async () => opts.assets ?? [],
      count: async () => (opts.assets ?? []).length,
    },
    user: { count: async () => 3 },
    tender: { count: async () => 5 },
    generatedDocument: { count: async () => 7 },
  } as any;
}

describe("db-recovery status — sanitization contract", () => {
  it("never includes DATABASE_URL, host, credentials, or record content", async () => {
    const prisma = makeMockPrisma({
      reachable: true,
      company: { id: "c1", settings: { defaultCurrency: "USD", exportFormat: "DOCX", language: "en" } },
      assets: [{ assetType: "LETTERHEAD", isActive: true }],
    });
    const status = await getDbRecoveryStatus(prisma, "u1");
    const serialized = JSON.stringify(status).toLowerCase();
    for (const forbidden of ["database_url", "postgres://", "postgresql://", "password", "secret", "@", "host=", "sslmode"]) {
      assert.ok(!serialized.includes(forbidden), `status must not leak "${forbidden}"`);
    }
    // Only counts, never records.
    assert.equal(typeof status.counts.tenders, "number");
  });
});

describe("db-recovery status — logic", () => {
  it("reports UNKNOWN + not reachable when the DB is down", async () => {
    const status = await getDbRecoveryStatus(makeMockPrisma({ reachable: false }), "u1");
    assert.equal(status.reachable, false);
    assert.equal(status.schemaCompatibility, "UNKNOWN");
  });

  it("flags missing required tables as INCOMPATIBLE", async () => {
    const status = await getDbRecoveryStatus(
      makeMockPrisma({ reachable: true, missingTables: ["AppSettings"], company: null }),
      "u1",
    );
    assert.equal(status.schemaCompatibility, "INCOMPATIBLE");
    assert.ok(status.missingTables.includes("AppSettings"));
  });

  it("marks initializationRequired when company exists but AppSettings does not", async () => {
    const status = await getDbRecoveryStatus(
      makeMockPrisma({ reachable: true, company: { id: "c1", settings: null } }),
      "u1",
    );
    assert.equal(status.companySettings.companyExists, true);
    assert.equal(status.companySettings.appSettingsExists, false);
    assert.equal(status.companySettings.initializationRequired, true);
    // Repair preview offers to initialize — a DRY-RUN action, never auto-applied.
    const preview = buildRepairPreview(status);
    assert.ok(preview.some((p) => p.action === "INITIALIZE_APP_SETTINGS"));
  });

  it("detects invalid restored settings by field name only", async () => {
    const status = await getDbRecoveryStatus(
      makeMockPrisma({ reachable: true, company: { id: "c1", settings: { defaultCurrency: "ZZZ", exportFormat: "ZIP", language: "en" } } }),
      "u1",
    );
    const fields = status.invalidRestoredSettings.map((f) => f.field);
    assert.ok(fields.includes("defaultCurrency"));
    assert.ok(fields.includes("exportFormat"));
    assert.ok(!fields.includes("language"));
  });

  it("lists branding asset types with no active asset", async () => {
    const status = await getDbRecoveryStatus(
      makeMockPrisma({ reachable: true, company: { id: "c1", settings: null }, assets: [{ assetType: "LETTERHEAD", isActive: false }] }),
      "u1",
    );
    assert.ok(status.branding.missingActiveAssetTypes.includes("LETTERHEAD"));
    assert.ok(status.branding.missingActiveAssetTypes.includes("SIGNATURE"));
    assert.equal(status.branding.inactiveAssetCount, 1);
  });
});
