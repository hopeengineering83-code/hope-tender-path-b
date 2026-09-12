import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("development database schema authority", () => {
  it("deploys the complete migration history before starting Next development", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
    const dev = pkg.scripts?.dev ?? "";
    assert.match(dev, /^prisma migrate deploy\s*&&\s*next dev$/);
  });

  it("the support-review migration owns every Legal/Financial/Compliance provenance field", () => {
    const migration = read("prisma/migrations/20260727130000_legal_financial_compliance_review_provenance/migration.sql");
    for (const table of ["LegalRecord", "FinancialRecord", "CompanyComplianceRecord"]) {
      assert.match(migration, new RegExp(`ALTER TABLE "${table}"`));
      for (const column of ["trustLevel", "reviewedBy", "reviewedAt", "reviewNotes", "sourceDocumentId"]) {
        assert.match(migration, new RegExp(`ADD COLUMN "${column}"`), `${table}.${column} must be migration-owned`);
      }
      assert.match(migration, new RegExp(`"${table}_sourceDocumentId_fkey"`));
      assert.match(migration, new RegExp(`"${table}_trustLevel_idx"`));
    }
  });

  it("production remains migration-owned and does not enable request-time schema mutation", () => {
    const prisma = read("lib/prisma.ts");
    assert.match(prisma, /if \(process\.env\.NODE_ENV !== "production"\) return true;/);
    assert.match(prisma, /return envFlag\("ENABLE_RUNTIME_SCHEMA_BOOTSTRAP"\);/);
    assert.match(prisma, /Run "prisma migrate deploy"/);
  });
});
