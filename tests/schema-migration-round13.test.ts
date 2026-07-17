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
    assert.ok(
      schema.includes("@@unique([tenderId, version]) // Prevents duplicate version numbers"),
      "ProposalVersion must prevent duplicate version numbers",
    );
  });

  it("GeneratedDocument documents and migrates its partial unique filename authority", () => {
    assert.match(
      schema,
      /Partial unique index on \(tenderId, exactFileName\)[\s\S]*migration-managed because Prisma cannot express the WHERE clause/,
    );
    assert.doesNotMatch(schema, /@@unique\(\[tenderId, exactFileName\]\)/);
    assert.match(sql, /CREATE UNIQUE INDEX "GeneratedDocument_tenderId_exactFileName_key"/);
    assert.match(sql, /ON "GeneratedDocument"\("tenderId", "exactFileName"\)/);
    assert.match(sql, /WHERE "exactFileName" IS NOT NULL/);
  });

  it("TenderFile declares contentHash and documents its partial unique migration authority", () => {
    assert.match(schema, /contentHash\s+String\?/);
    assert.match(
      schema,
      /Partial unique index on \(tenderId, contentHash\)[\s\S]*migration-managed so[\s\S]*NULL legacy hashes remain compatible/,
    );
    assert.doesNotMatch(schema, /@@unique\(\[tenderId, contentHash\]\)/);
    assert.match(sql, /CREATE UNIQUE INDEX "TenderFile_tenderId_contentHash_key"/);
    assert.match(sql, /WHERE "contentHash" IS NOT NULL AND "contentHash" != ''/);
  });
});

describe("round 13 — migration file", () => {
  it("exists with dedup and partial unique-index SQL", () => {
    assert.ok(existsSync(migrationPath), "migration file must exist");
    const sql = read(migrationPath);
    assert.ok(sql.includes("ProposalVersion_tenderId_version_key"), "must create ProposalVersion unique index");
    assert.ok(sql.includes('DISTINCT ON ("tenderId", "version")'), "must dedup ProposalVersion before adding constraint");
    assert.ok(sql.includes("GeneratedDocument_tenderId_exactFileName_key"), "must create GeneratedDocument unique index");
    assert.ok(sql.includes('WHERE "exactFileName" IS NOT NULL'), "must use partial index for non-null exactFileName");
    assert.ok(sql.includes('ADD COLUMN "contentHash"'), "must add contentHash column");
    assert.ok(sql.includes("TenderFile_tenderId_contentHash_key"), "must create TenderFile unique index");
    assert.ok(sql.includes("md5(COALESCE"), "must backfill contentHash with md5");
    assert.ok(sql.includes('WHERE "contentHash" IS NOT NULL AND "contentHash" != \'\''), "must exclude empty legacy hashes");
  });
});

describe("round 13 — contentHash computation in upload", () => {
  const source = read("lib/tender-upload-first.ts");

  it("computes contentHash at upload time", () => {
    assert.ok(source.includes('crypto.createHash("md5")'), "must compute md5 contentHash at upload time");
    assert.ok(source.includes("contentHash,"), "must store contentHash in the TenderFile create");
  });
});

describe("round 13 — T6: export route tender status in transaction", () => {
  const source = read("app/api/tenders/[id]/export/route.ts");

  it("wraps tender status update in a transaction", () => {
    assert.ok(
      source.includes("prisma.$transaction(async (tx) => {") && source.includes("tx.tender.update"),
      "must use $transaction with tx.tender.update",
    );
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
