// Runtime-bootstrap index parity with migrations.
//
// lib/prisma.ts's dev/runtime bootstrap creates indexes with
// CREATE INDEX IF NOT EXISTS so environments without migrations still get
// the schema's indexes. Three of those statements drifted from the
// migrations (DocumentComment_documentId_idx, MatchScoreBreakdown_unique_dim,
// SectionEvidenceMap_unique_section): every database that BOOTED the app
// gained indexes that neither prisma/schema.prisma nor any migration
// declares — two of them duplicating existing unique constraints under a
// second name — so app-booted databases failed the release zero-drift check
// (prisma migrate diff) and paid double index maintenance on hot writes.
//
// This test pins the invariant: every index name the bootstrap creates must
// also be created by a migration. (The reverse is NOT required — migrations
// may create indexes the bootstrap skips.)

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

describe("bootstrap index / migration parity", () => {
  it("every bootstrap-created index name exists in a migration", () => {
    const prismaSrc = readFileSync("lib/prisma.ts", "utf8");
    const bootstrapIndexes = [...prismaSrc.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS "([^"]+)"/g)].map((m) => m[1]);
    assert.ok(bootstrapIndexes.length > 50, `expected the bootstrap index list (found ${bootstrapIndexes.length})`);

    let migrationSql = "";
    const migrationsDir = "prisma/migrations";
    for (const entry of readdirSync(migrationsDir)) {
      try {
        migrationSql += readFileSync(join(migrationsDir, entry, "migration.sql"), "utf8");
      } catch {
        // non-directory entries (migration_lock.toml)
      }
    }
    const declared = new Set(
      [...migrationSql.matchAll(/CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?"([^"]+)"/g)].map((m) => m[1]),
    );

    const undeclared = bootstrapIndexes.filter((name) => !declared.has(name));
    assert.deepEqual(
      undeclared,
      [],
      `bootstrap creates indexes no migration declares (app-booted databases will fail zero-drift): ${undeclared.join(", ")}`,
    );
  });

  it("the three previously-drifting index names stay out of the bootstrap", () => {
    const prismaSrc = readFileSync("lib/prisma.ts", "utf8");
    for (const name of ["DocumentComment_documentId_idx", "MatchScoreBreakdown_unique_dim", "SectionEvidenceMap_unique_section"]) {
      assert.ok(
        !prismaSrc.includes(`"${name}"`),
        `${name} must not be re-created by the bootstrap — the schema/migrations already cover it`,
      );
    }
  });
});
