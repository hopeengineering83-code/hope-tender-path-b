/**
 * Regression tests for schema migration gaps (round 13).
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("round 13 — schema unique constraints", () => {
  const schema = read("prisma/schema.prisma");

  it("ProposalVersion has @@unique([tenderId, version])", () => {
    assert.ok(
      schema.includes('@@unique([tenderId, version]) // Prevents duplicate version numbers'),
      "ProposalVersion must have @@unique([tenderId, version]) — prevents duplicate version numbers",
    );
  });

  it("GeneratedDocument has @@index([tenderId, exactFileName]) (partial unique via migration)", () => {
    // The full @@unique was replaced with a PARTIAL unique index (via migration
    // 20260705000000) that only applies to non-SUPERSEDED rows. The schema
    // uses @@index because Prisma doesn't support partial unique indexes in
    // the schema language — the actual unique constraint is in the migration SQL.
    assert.ok(
      schema.includes("@@index([tenderId, exactFileName])"),
      "GeneratedDocument must have @@index([tenderId, exactFileName]) (partial unique via migration)",
    );
    assert.ok(
      !schema.includes("@@unique([tenderId, exactFileName])"),
      "full @@unique must be removed (replaced by partial unique index in migration)",
    );
  });

  it("TenderFile has contentHash column + @@unique([tenderId, contentHash])", () => {
    assert.ok(
      schema.includes('contentHash      String?'),
      "TenderFile must have contentHash column",
    );
    assert.ok(
      schema.includes("@@unique([tenderId, contentHash])"),
      "TenderFile must have @@unique([tenderId, contentHash]) — prevents duplicate uploads",
    );
  });
});

describe("round 13 — migration file", () => {
  it("migration file exists with dedup + unique index SQL", () => {
    const migrationPath = "prisma/migrations/20260704000000_add_unique_constraints_and_content_hash/migration.sql";
    assert.ok(existsSync(migrationPath), "migration file must exist");
    const sql = read(migrationPath);
    // ProposalVersion dedup + unique
    assert.ok(sql.includes("ProposalVersion_tenderId_version_key"), "must create ProposalVersion unique index");
    assert.ok(sql.includes('DISTINCT ON ("tenderId", "version")'), "must dedup ProposalVersion before adding constraint");
    // GeneratedDocument dedup + unique (partial index for non-null exactFileName)
    assert.ok(sql.includes("GeneratedDocument_tenderId_exactFileName_key"), "must create GeneratedDocument unique index");
    assert.ok(sql.includes('WHERE "exactFileName" IS NOT NULL'), "must use partial index for non-null exactFileName");
    // TenderFile contentHash + dedup + unique
    assert.ok(sql.includes('ADD COLUMN "contentHash"'), "must add contentHash column");
    assert.ok(sql.includes("TenderFile_tenderId_contentHash_key"), "must create TenderFile unique index");
    assert.ok(sql.includes("md5(COALESCE"), "must backfill contentHash with md5");
  });
});

describe("round 13 — contentHash computation in upload", () => {
  const src = read("lib/tender-upload-first.ts");

  it("computes contentHash at upload time", () => {
    assert.ok(
      src.includes('crypto.createHash("md5")'),
      "must compute md5 contentHash at upload time",
    );
    assert.ok(
      src.includes("contentHash,"),
      "must store contentHash in the TenderFile create",
    );
  });
});

describe("round 13 — T6: export route tender status in transaction", () => {
  const src = read("app/api/tenders/[id]/export/route.ts");

  it("wraps tender status update in a transaction (not bare update)", () => {
    // The old pattern was a bare prisma.tender.update OUTSIDE the export
    // package transaction. Now it's in its own $transaction.
    assert.ok(
      src.includes("prisma.$transaction(async (tx) => {") &&
      src.includes("tx.tender.update"),
      "must use $transaction with tx.tender.update (was bare prisma.tender.update outside tx)",
    );
  });
});

describe("round 13 — O4: company doc delete surfaces orphaned REVIEWED records", () => {
  const src = read("app/api/company/documents/[id]/route.ts");

  it("counts REVIEWED experts/projects that will lose provenance", () => {
    assert.ok(
      src.includes("reviewedExpertsOrphaned"),
      "must count reviewedExpertsOrphaned before delete",
    );
    assert.ok(
      src.includes("reviewedProjectsOrphaned"),
      "must count reviewedProjectsOrphaned before delete",
    );
    assert.ok(
      src.includes('trustLevel: "REVIEWED"'),
      "must filter by trustLevel REVIEWED",
    );
  });
});
