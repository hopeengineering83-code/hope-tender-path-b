/**
 * Regression tests for schema migration gaps (round 13).
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const migrationPath = "prisma/migrations/20260704000000_add_unique_constraints_and_content_hash/migration.sql";

describe("round 13 — schema and migration-managed unique constraints", () => {
  const schema = read("prisma/schema.prisma");
  const sql = read(migrationPath);

  it("ProposalVersion has a Prisma-expressible tender/version unique constraint", () => {
    assert.ok(schema.includes("@@unique([tenderId, version]) // Prevents duplicate version numbers"));
  });

  it("GeneratedDocument documents and migrates its partial unique filename authority", () => {
    assert.match(schema, /Partial unique index on \(tenderId, exactFileName\)[\s\S]*migration-managed because Prisma cannot express the WHERE clause/);
    assert.doesNotMatch(schema, /@@unique\(\[tenderId, exactFileName\]\)/);
    assert.match(sql, /CREATE UNIQUE INDEX "GeneratedDocument_tenderId_exactFileName_key"/);
    assert.match(sql, /ON "GeneratedDocument"\("tenderId", "exactFileName"\)/);
    assert.match(sql, /WHERE "exactFileName" IS NOT NULL/);
  });

  it("TenderFile declares contentHash and documents its partial unique migration authority", () => {
    assert.match(schema, /contentHash\s+String\?/);
    assert.match(schema, /Partial unique index on \(tenderId, contentHash\)[\s\S]*migration-managed so[\s\S]*NULL legacy hashes remain compatible/);
    assert.doesNotMatch(schema, /@@unique\(\[tenderId, contentHash\]\)/);
    assert.match(sql, /CREATE UNIQUE INDEX "TenderFile_tenderId_contentHash_key"/);
    assert.match(sql, /WHERE "contentHash" IS NOT NULL AND "contentHash" != ''/);
  });
});

describe("round 13 — migration file", () => {
  it("exists with dedup and partial unique-index SQL", () => {
    assert.ok(existsSync(migrationPath));
    const sql = read(migrationPath);
    assert.ok(sql.includes("ProposalVersion_tenderId_version_key"));
    assert.ok(sql.includes('DISTINCT ON ("tenderId", "version")'));
    assert.ok(sql.includes("GeneratedDocument_tenderId_exactFileName_key"));
    assert.ok(sql.includes('WHERE "exactFileName" IS NOT NULL'));
    assert.ok(sql.includes('ADD COLUMN "contentHash"'));
    assert.ok(sql.includes("TenderFile_tenderId_contentHash_key"));
    assert.ok(sql.includes("md5(COALESCE"));
    assert.ok(sql.includes('WHERE "contentHash" IS NOT NULL AND "contentHash" != \'\''));
  });
});

describe("round 13 — contentHash computation in upload", () => {
  const source = read("lib/tender-upload-first.ts");

  it("computes contentHash from the actual-byte SHA-256 integrity digest at upload time", () => {
    assert.ok(source.includes("upload.integrity.contentSha256"));
    assert.ok(source.includes("contentHash,"));
  });
});

describe("round 13 — T6: live Final ZIP lifecycle state is transaction-bound", () => {
  const download = read("app/api/tenders/[id]/download/route.ts");
  const persistence = read("lib/engine/export-package-persistence.ts");

  it("the live route delegates verified ZIP persistence to one transaction owner", () => {
    assert.match(download, /persistVerifiedExportPackageDownload/);
    assert.match(persistence, /prisma\.\$transaction\(async \(tx\) => \{/);
    assert.match(persistence, /tx\.exportPackage\.(?:create|update)/);
    assert.match(persistence, /tx\.tender\.update/);
    assert.match(persistence, /status:\s*"EXPORTED",\s*stage:\s*"EXPORT"/);
  });
});

describe("round 13 — O4: company doc delete preserves REVIEWED provenance", () => {
  const service = read("lib/company-document-durable-deletion.ts");
  const collection = read("app/api/company/documents/route.ts");
  const detail = read("app/api/company/documents/[id]/route.ts");

  it("counts REVIEWED dependencies and blocks instead of orphaning them", () => {
    assert.ok(service.includes("reviewedExperts") && service.includes("reviewedProjects"));
    assert.ok(service.includes('trustLevel: "REVIEWED"'));
    assert.ok(service.includes('code: "REVIEWED_PROVENANCE_DEPENDENCY"'));
  });

  it("uses the same durable deletion service from both routes", () => {
    assert.ok(collection.includes("deleteCompanyDocumentDurably("));
    assert.ok(detail.includes("deleteCompanyDocumentDurably("));
    assert.ok(!collection.includes("prisma.companyDocument.delete({"));
  });
});
