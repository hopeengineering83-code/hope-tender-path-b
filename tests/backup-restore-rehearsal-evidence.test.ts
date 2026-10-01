// Backup/restore rehearsal evidence (evidence C for Category 9)
//
// These tests verify the backup/restore script exists and has the correct
// structure, and verify that the application's rollback procedure is
// documented and testable.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";

const read = (path: string): string => readFileSync(path, "utf8");

describe("DIRECTIVE 22 — Backup/restore rehearsal script (evidence C)", () => {
  it("rehearse-backup-restore.sh exists and has correct structure", () => {
    assert.ok(existsSync("scripts/rehearse-backup-restore.sh"), "Backup/restore script must exist");

    const script = read("scripts/rehearse-backup-restore.sh");
    // Must perform pg_dump
    assert.match(script, /pg_dump/, "Script must use pg_dump for backup");
    // Must restore to isolated target
    assert.match(script, /psql.*BACKUP_FILE/, "Script must restore using psql");
    // Must verify critical tables
    assert.match(script, /CRITICAL_TABLES/, "Script must verify critical tables");
    // Must verify Prisma zero drift
    assert.match(script, /prisma migrate status/, "Script must verify Prisma zero drift");
    // Must refuse to run against Production
    assert.match(script, /refuse.*target.*production|Target.*identical.*Production/i, "Script must refuse to run against Production");
    // Must include Blob backup rehearsal
    assert.match(script, /Blob.*backup|BLOB_READ_WRITE_TOKEN/, "Script must include Blob backup rehearsal");
    // Must document rollback procedure
    assert.match(script, /Rollback procedure|rollback/i, "Script must document rollback procedure");
  });

  it("verify-production-artifacts.mjs exists and has correct structure", () => {
    assert.ok(existsSync("scripts/verify-production-artifacts.mjs"), "Artifact verification script must exist");

    const script = read("scripts/verify-production-artifacts.mjs");
    // Must fetch /api/health
    assert.match(script, /api\/health/, "Script must fetch /api/health");
    // Must download artifacts
    assert.match(script, /download/, "Script must download artifacts");
    // Must verify DOCX OPC structure
    assert.match(script, /word\/document\.xml/, "Script must verify DOCX OPC structure");
    // Must verify PDF header
    assert.match(script, /PDF-/, "Script must verify PDF header");
    // Must verify ZIP header
    assert.match(script, /0x50.*0x4b|PK/, "Script must verify ZIP header");
    // Must compute SHA-256
    assert.match(script, /sha256|createHash/, "Script must compute SHA-256");
  });

  it("OWNER_ACTION_CHECKLIST.md exists with rollback procedure", () => {
    assert.ok(existsSync("OWNER_ACTION_CHECKLIST.md"), "Owner action checklist must exist");

    const checklist = read("OWNER_ACTION_CHECKLIST.md");
    // Must document credential rotation
    assert.match(checklist, /GitHub PAT|Vercel token/i, "Must document credential rotation");
    // Must document backup/restore rehearsal
    assert.match(checklist, /backup.*restore|rehearse/i, "Must document backup/restore rehearsal");
    // Must document rollback procedure
    assert.match(checklist, /rollback|known-good.*SHA/i, "Must document rollback procedure");
    // Must document Production UAT
    assert.match(checklist, /Production.*UAT|authenticated.*Production/i, "Must document Production UAT");
  });
});
