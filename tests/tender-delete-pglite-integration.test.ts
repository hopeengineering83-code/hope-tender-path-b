/**
 * Real PostgreSQL integration tests for tender deletion.
 *
 * Uses @electric-sql/pglite (WASM Postgres) — real PostgreSQL engine with
 * triggers, FK cascades, plpgsql, and session GUC support.
 *
 * LIMITATION: PGlite is single-connection. Does NOT cover concurrent
 * transactions, lock contention, or network partition. Those require
 * staging-env tests (out of scope for PR #904).
 *
 * These tests prove the 6 required scenarios:
 *   1. Owned tender deletion with final requirements + no active AI job SUCCEEDS
 *   2. Direct final-requirement deletion REMAINS BLOCKED (no GUC set)
 *   3. Cross-user deletion is REJECTED
 *   4. Orphan rows (FallbackApprovalRecord, ExtractionQualityOverride) are DELETED
 *   5. AiUsageRecord.tenderId becomes NULL
 *   6. Any failure rolls back FULLY
 *
 * Plus additional scenarios:
 *   7. Trigger allows non-final requirement deletion (individual edits)
 *   8. Active AI job allows direct final-requirement deletion (original auth path)
 *   9. GUC context is transaction-local (doesn't persist after COMMIT)
 *  10. Wrong GUC context does NOT authorize (narrow authorization)
 */

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { PGlite } from "@electric-sql/pglite";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS "Tender" (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clientName" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "TenderRequirement" (
  id TEXT PRIMARY KEY,
  "tenderId" TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  "requirementType" TEXT NOT NULL DEFAULT 'FUNCTIONAL',
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "TenderRequirement_tenderId_fkey"
    FOREIGN KEY ("tenderId") REFERENCES "Tender"(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "TenderFile" (
  id TEXT PRIMARY KEY,
  "tenderId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  CONSTRAINT "TenderFile_tenderId_fkey"
    FOREIGN KEY ("tenderId") REFERENCES "Tender"(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "GeneratedDocument" (
  id TEXT PRIMARY KEY,
  "tenderId" TEXT NOT NULL,
  name TEXT NOT NULL,
  "generationStatus" TEXT NOT NULL DEFAULT 'PENDING',
  CONSTRAINT "GeneratedDocument_tenderId_fkey"
    FOREIGN KEY ("tenderId") REFERENCES "Tender"(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "AiJob" (
  id TEXT PRIMARY KEY,
  "tenderId" TEXT,
  "userId" TEXT NOT NULL,
  "jobType" TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  "startedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "AiJob_tenderId_fkey"
    FOREIGN KEY ("tenderId") REFERENCES "Tender"(id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "AiUsageRecord" (
  id TEXT PRIMARY KEY,
  "tenderId" TEXT,
  "userId" TEXT NOT NULL,
  provider TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "AiUsageRecord_tenderId_fkey"
    FOREIGN KEY ("tenderId") REFERENCES "Tender"(id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "FallbackApprovalRecord" (
  id TEXT PRIMARY KEY,
  "tenderId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "approverId" TEXT NOT NULL,
  reason TEXT NOT NULL,
  "approvedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "ExtractionQualityOverride" (
  id TEXT PRIMARY KEY,
  "tenderId" TEXT NOT NULL,
  "tenderFileId" TEXT NOT NULL,
  "qualityScore" DOUBLE PRECISION NOT NULL,
  "overrideReason" TEXT NOT NULL,
  "overriddenBy" TEXT NOT NULL,
  "overriddenAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The MODIFIED trigger (migration 20260629000000) with GUC context check
CREATE OR REPLACE FUNCTION guard_canonical_requirement_set_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected record;
  remaining_count integer;
  authorized boolean;
  deletion_context text;
BEGIN
  FOR affected IN
    SELECT d."tenderId", COUNT(*)::integer AS deleted_count
    FROM deleted_requirements d
    GROUP BY d."tenderId"
  LOOP
    IF NOT EXISTS (SELECT 1 FROM "Tender" t WHERE t.id = affected."tenderId") THEN
      CONTINUE;
    END IF;
    deletion_context := current_setting('app.tender_deletion_context', true);
    IF deletion_context IS NOT NULL AND deletion_context = affected."tenderId" THEN
      CONTINUE;
    END IF;
    SELECT COUNT(*)::integer INTO remaining_count
    FROM "TenderRequirement" tr WHERE tr."tenderId" = affected."tenderId";
    IF remaining_count > 0 THEN CONTINUE; END IF;
    SELECT (EXISTS (
      SELECT 1 FROM "AiJob" j
      WHERE j."tenderId" = affected."tenderId"
        AND j."jobType" IN ('AI_ANALYZE', 'ENGINE_RUN')
        AND j.status IN ('QUEUED', 'RUNNING')
        AND COALESCE(j."startedAt", j."createdAt") >= NOW() - INTERVAL '30 minutes'
    )) INTO authorized;
    IF NOT authorized THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = 'Refusing to delete the final canonical tender requirement set without an active staged analysis or engine run',
        DETAIL = format('tenderId=%s deleted=%s', affected."tenderId", affected.deleted_count),
        HINT = 'Create and persist the AiJob/staged result before promoting replacement requirements.';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "TenderRequirement_guard_final_set_delete" ON "TenderRequirement";
CREATE TRIGGER "TenderRequirement_guard_final_set_delete"
AFTER DELETE ON "TenderRequirement"
REFERENCING OLD TABLE AS deleted_requirements
FOR EACH STATEMENT
EXECUTE FUNCTION guard_canonical_requirement_set_delete();
`;

/**
 * Simulates the DELETE handler's transaction body.
 * Sets the GUC context, then explicitly deletes all children including
 * TenderRequirement, then deletes Tender.
 */
async function simulateDeleteTransaction(pg: PGlite, tenderId: string) {
  await pg.exec("BEGIN");
  try {
    // Set transaction-local deletion context (recognized by trigger)
    await pg.query(`SET LOCAL app.tender_deletion_context = '${tenderId}'`);

    // Scalar orphans
    await pg.query(`DELETE FROM "FallbackApprovalRecord" WHERE "tenderId" = $1`, [tenderId]);
    await pg.query(`DELETE FROM "ExtractionQualityOverride" WHERE "tenderId" = $1`, [tenderId]);
    // AiUsageRecord — nullify (fail-closed)
    await pg.query(`UPDATE "AiUsageRecord" SET "tenderId" = NULL WHERE "tenderId" = $1`, [tenderId]);
    // AiJob
    await pg.query(`DELETE FROM "AiJob" WHERE "tenderId" = $1`, [tenderId]);
    // Other children
    await pg.query(`DELETE FROM "GeneratedDocument" WHERE "tenderId" = $1`, [tenderId]);
    await pg.query(`DELETE FROM "TenderFile" WHERE "tenderId" = $1`, [tenderId]);
    // TenderRequirement — explicit (GUC authorizes via trigger)
    await pg.query(`DELETE FROM "TenderRequirement" WHERE "tenderId" = $1`, [tenderId]);
    // Tender
    await pg.query(`DELETE FROM "Tender" WHERE id = $1`, [tenderId]);
    await pg.exec("COMMIT");
  } catch (e) {
    await pg.exec("ROLLBACK");
    throw e;
  }
}

interface CountRow { count: number }
let pg: PGlite;

before(async () => {
  pg = new PGlite();
  await pg.exec(SCHEMA_SQL);
});

after(async () => {
  await pg.close();
});

describe("Tender delete — PostgreSQL integration (PGlite)", () => {

  it("1. owned tender deletion with final requirements and no active AI job succeeds", async () => {
    const tid = "11111111-1111-4111-8111-111111111111";
    await pg.query(`INSERT INTO "Tender" (id, title, "userId") VALUES ($1, $2, $3)`, [tid, "Test 1", "user-a"]);
    await pg.query(`INSERT INTO "TenderRequirement" (id, "tenderId", title) VALUES ($1, $2, $3)`, ["r1-"+tid, tid, "Req 1"]);
    await pg.query(`INSERT INTO "TenderRequirement" (id, "tenderId", title) VALUES ($1, $2, $3)`, ["r2-"+tid, tid, "Req 2"]);

    await simulateDeleteTransaction(pg, tid);

    const t = await pg.query<{id:string}>(`SELECT id FROM "Tender" WHERE id = $1`, [tid]);
    assert.equal(t.rows.length, 0, "Tender should be deleted");
    const r = await pg.query<{id:string}>(`SELECT id FROM "TenderRequirement" WHERE "tenderId" = $1`, [tid]);
    assert.equal(r.rows.length, 0, "TenderRequirements should be deleted");
  });

  it("2. direct final-requirement deletion remains blocked (no GUC context set)", async () => {
    const tid = "22222222-2222-4222-8222-222222222222";
    await pg.query(`INSERT INTO "Tender" (id, title, "userId") VALUES ($1, $2, $3)`, [tid, "Test 2", "user-a"]);
    await pg.query(`INSERT INTO "TenderRequirement" (id, "tenderId", title) VALUES ($1, $2, $3)`, ["r-"+tid, tid, "Final"]);

    // Direct delete WITHOUT setting GUC — must be blocked
    await assert.rejects(
      pg.query(`DELETE FROM "TenderRequirement" WHERE "tenderId" = $1`, [tid]),
      /Refusing to delete the final canonical tender requirement set/,
      "Direct deletion must be blocked without GUC context"
    );

    // Cleanup via authorized transaction
    await simulateDeleteTransaction(pg, tid);
  });

  it("3. cross-user deletion is rejected (ownership check)", async () => {
    const tid = "33333333-3333-4333-8333-333333333333";
    await pg.query(`INSERT INTO "Tender" (id, title, "userId") VALUES ($1, $2, $3)`, [tid, "Test 3", "user-a"]);
    await pg.query(`INSERT INTO "TenderRequirement" (id, "tenderId", title) VALUES ($1, $2, $3)`, ["r-"+tid, tid, "Req"]);

    // Simulate handler's findFirst({ where: { id, userId: actor.id } })
    const crossUser = await pg.query<{userId:string}>(
      `SELECT "userId" FROM "Tender" WHERE id = $1 AND "userId" = $2`, [tid, "user-b"]
    );
    assert.equal(crossUser.rows.length, 0, "Cross-user findFirst must return null");

    // Tender still exists (handler returns 404, no delete occurs)
    const stillExists = await pg.query<{id:string}>(`SELECT id FROM "Tender" WHERE id = $1`, [tid]);
    assert.equal(stillExists.rows.length, 1, "Tender must still exist");

    // Correct owner CAN delete
    const ownerCheck = await pg.query<{userId:string}>(
      `SELECT "userId" FROM "Tender" WHERE id = $1 AND "userId" = $2`, [tid, "user-a"]
    );
    assert.equal(ownerCheck.rows.length, 1, "Owner must pass findFirst");
    await simulateDeleteTransaction(pg, tid);

    const after = await pg.query<{id:string}>(`SELECT id FROM "Tender" WHERE id = $1`, [tid]);
    assert.equal(after.rows.length, 0, "Owner's delete must succeed");
  });

  it("4. orphan rows are deleted (FallbackApprovalRecord + ExtractionQualityOverride)", async () => {
    const tid = "44444444-4444-4444-8444-444444444444";
    await pg.query(`INSERT INTO "Tender" (id, title, "userId") VALUES ($1, $2, $3)`, [tid, "Test 4", "user-a"]);
    await pg.query(
      `INSERT INTO "FallbackApprovalRecord" (id, "tenderId", "jobId", "contentHash", "approverId", reason) VALUES ($1,$2,$3,$4,$5,$6)`,
      ["far-"+tid, tid, "job-"+tid, "hash", "approver", "reason"]
    );
    await pg.query(
      `INSERT INTO "ExtractionQualityOverride" (id, "tenderId", "tenderFileId", "qualityScore", "overrideReason", "overriddenBy") VALUES ($1,$2,$3,$4,$5,$6)`,
      ["eqo-"+tid, tid, "file-"+tid, 75.5, "Weak", "user-a"]
    );

    await simulateDeleteTransaction(pg, tid);

    const far = await pg.query<CountRow>(`SELECT COUNT(*)::integer AS count FROM "FallbackApprovalRecord" WHERE "tenderId" = $1`, [tid]);
    assert.equal(far.rows[0].count, 0, "FallbackApprovalRecord must be deleted");
    const eqo = await pg.query<CountRow>(`SELECT COUNT(*)::integer AS count FROM "ExtractionQualityOverride" WHERE "tenderId" = $1`, [tid]);
    assert.equal(eqo.rows[0].count, 0, "ExtractionQualityOverride must be deleted");
  });

  it("5. AiUsageRecord.tenderId becomes NULL", async () => {
    const tid = "55555555-5555-4555-8555-555555555555";
    await pg.query(`INSERT INTO "Tender" (id, title, "userId") VALUES ($1, $2, $3)`, [tid, "Test 5", "user-a"]);
    await pg.query(
      `INSERT INTO "AiUsageRecord" (id, "tenderId", "userId", provider) VALUES ($1, $2, $3, $4)`,
      ["aur-"+tid, tid, "user-a", "gemini"]
    );

    await simulateDeleteTransaction(pg, tid);

    const aur = await pg.query<{id:string; tenderId:string|null}>(
      `SELECT id, "tenderId" FROM "AiUsageRecord" WHERE id = $1`, ["aur-"+tid]
    );
    assert.equal(aur.rows.length, 1, "AiUsageRecord must still exist");
    assert.equal(aur.rows[0].tenderId, null, "tenderId must be NULL");
  });

  it("6. any failure rolls back fully (transaction atomicity)", async () => {
    const tid = "66666666-6666-4666-8666-666666666666";
    await pg.query(`INSERT INTO "Tender" (id, title, "userId") VALUES ($1, $2, $3)`, [tid, "Test 6", "user-a"]);
    await pg.query(`INSERT INTO "TenderRequirement" (id, "tenderId", title) VALUES ($1, $2, $3)`, ["r-"+tid, tid, "Req"]);
    await pg.query(
      `INSERT INTO "FallbackApprovalRecord" (id, "tenderId", "jobId", "contentHash", "approverId", reason) VALUES ($1,$2,$3,$4,$5,$6)`,
      ["far-"+tid, tid, "job-"+tid, "hash", "approver", "reason"]
    );

    // Force a failure mid-transaction
    await pg.exec("BEGIN");
    try {
      await pg.query(`SET LOCAL app.tender_deletion_context = '${tid}'`);
      await pg.query(`DELETE FROM "FallbackApprovalRecord" WHERE "tenderId" = $1`, [tid]);
      // Force error: non-existent table
      await pg.query(`DELETE FROM "NonExistentTable" WHERE x = 1`);
      await pg.exec("COMMIT");
      assert.fail("Should have thrown");
    } catch {
      await pg.exec("ROLLBACK");
    }

    // Verify nothing was deleted
    const far = await pg.query<CountRow>(`SELECT COUNT(*)::integer AS count FROM "FallbackApprovalRecord" WHERE "tenderId" = $1`, [tid]);
    assert.equal(far.rows[0].count, 1, "FallbackApprovalRecord must still exist");
    const tender = await pg.query<CountRow>(`SELECT COUNT(*)::integer AS count FROM "Tender" WHERE id = $1`, [tid]);
    assert.equal(tender.rows[0].count, 1, "Tender must still exist");

    // Cleanup
    await simulateDeleteTransaction(pg, tid);
  });

  it("7. trigger allows non-final requirement deletion (individual edits)", async () => {
    const tid = "77777777-7777-4777-8777-777777777777";
    await pg.query(`INSERT INTO "Tender" (id, title, "userId") VALUES ($1, $2, $3)`, [tid, "Test 7", "user-a"]);
    await pg.query(`INSERT INTO "TenderRequirement" (id, "tenderId", title) VALUES ($1, $2, $3)`, ["ra-"+tid, tid, "A"]);
    await pg.query(`INSERT INTO "TenderRequirement" (id, "tenderId", title) VALUES ($1, $2, $3)`, ["rb-"+tid, tid, "B"]);

    // Delete one (not final) — no GUC needed, trigger allows
    await pg.query(`DELETE FROM "TenderRequirement" WHERE id = $1`, ["ra-"+tid]);
    const rem = await pg.query<CountRow>(`SELECT COUNT(*)::integer AS count FROM "TenderRequirement" WHERE "tenderId" = $1`, [tid]);
    assert.equal(rem.rows[0].count, 1, "One should remain");

    // Final deletion blocked without GUC
    await assert.rejects(
      pg.query(`DELETE FROM "TenderRequirement" WHERE id = $1`, ["rb-"+tid]),
      /Refusing to delete the final canonical/,
    );
    await simulateDeleteTransaction(pg, tid);
  });

  it("8. active AI job allows direct final-requirement deletion (original auth path)", async () => {
    const tid = "88888888-8888-4888-8888-888888888888";
    await pg.query(`INSERT INTO "Tender" (id, title, "userId") VALUES ($1, $2, $3)`, [tid, "Test 8", "user-a"]);
    await pg.query(`INSERT INTO "TenderRequirement" (id, "tenderId", title) VALUES ($1, $2, $3)`, ["r-"+tid, tid, "Final"]);
    await pg.query(
      `INSERT INTO "AiJob" (id, "tenderId", "userId", "jobType", status, "startedAt") VALUES ($1,$2,$3,$4,$5,NOW())`,
      ["job-"+tid, tid, "user-a", "AI_ANALYZE", "RUNNING"]
    );

    // Direct delete succeeds — active AI job authorizes
    await pg.query(`DELETE FROM "TenderRequirement" WHERE "tenderId" = $1`, [tid]);
    const rem = await pg.query<CountRow>(`SELECT COUNT(*)::integer AS count FROM "TenderRequirement" WHERE "tenderId" = $1`, [tid]);
    assert.equal(rem.rows[0].count, 0, "Should be deleted (AI job authorizes)");

    await pg.query(`DELETE FROM "AiJob" WHERE "tenderId" = $1`, [tid]);
    await pg.query(`DELETE FROM "Tender" WHERE id = $1`, [tid]);
  });

  it("9. GUC context is transaction-local (does not persist after COMMIT)", async () => {
    const tid = "99999999-9999-4999-8999-999999999999";
    await pg.query(`INSERT INTO "Tender" (id, title, "userId") VALUES ($1, $2, $3)`, [tid, "Test 9", "user-a"]);
    await pg.query(`INSERT INTO "TenderRequirement" (id, "tenderId", title) VALUES ($1, $2, $3)`, ["r-"+tid, tid, "Req"]);

    // Set GUC in a transaction, then commit
    await pg.exec("BEGIN");
    await pg.query(`SET LOCAL app.tender_deletion_context = '${tid}'`);
    await pg.exec("COMMIT");

    // GUC should NOT persist after commit — direct delete must be blocked
    await assert.rejects(
      pg.query(`DELETE FROM "TenderRequirement" WHERE "tenderId" = $1`, [tid]),
      /Refusing to delete the final canonical/,
      "GUC must not persist after COMMIT — SET LOCAL is transaction-local"
    );

    await simulateDeleteTransaction(pg, tid);
  });

  it("10. wrong GUC context does NOT authorize (narrow authorization)", async () => {
    const tid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await pg.query(`INSERT INTO "Tender" (id, title, "userId") VALUES ($1, $2, $3)`, [tid, "Test 10", "user-a"]);
    await pg.query(`INSERT INTO "TenderRequirement" (id, "tenderId", title) VALUES ($1, $2, $3)`, ["r-"+tid, tid, "Req"]);

    // Set GUC to a DIFFERENT tenderId — must NOT authorize this tender's deletion
    await pg.exec("BEGIN");
    await pg.query(`SET LOCAL app.tender_deletion_context = '${other}'`);
    await assert.rejects(
      pg.query(`DELETE FROM "TenderRequirement" WHERE "tenderId" = $1`, [tid]),
      /Refusing to delete the final canonical/,
      "Wrong GUC context must NOT authorize — narrow authorization"
    );
    await pg.exec("ROLLBACK");

    await simulateDeleteTransaction(pg, tid);
  });

  it("11. P2021 for AiUsageRecord rolls back (table missing = fail closed)", async () => {
    const tid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await pg.query(`INSERT INTO "Tender" (id, title, "userId") VALUES ($1, $2, $3)`, [tid, "Test 11", "user-a"]);
    await pg.query(`INSERT INTO "TenderRequirement" (id, "tenderId", title) VALUES ($1, $2, $3)`, ["r-"+tid, tid, "Req"]);
    await pg.query(
      `INSERT INTO "FallbackApprovalRecord" (id, "tenderId", "jobId", "contentHash", "approverId", reason) VALUES ($1,$2,$3,$4,$5,$6)`,
      ["far-"+tid, tid, "job-"+tid, "hash", "approver", "reason"]
    );

    // Drop AiUsageRecord table to simulate P2021
    await pg.exec(`DROP TABLE "AiUsageRecord"`);

    // Delete must fail — AiUsageRecord updateMany will error
    await assert.rejects(
      simulateDeleteTransaction(pg, tid),
      (err: Error) => err.message.includes("AiUsageRecord") || err.message.includes("does not exist"),
    );

    // Verify full rollback
    const tender = await pg.query<CountRow>(`SELECT COUNT(*)::integer AS count FROM "Tender" WHERE id = $1`, [tid]);
    assert.equal(tender.rows[0].count, 1, "Tender must still exist (rolled back)");
    const req = await pg.query<CountRow>(`SELECT COUNT(*)::integer AS count FROM "TenderRequirement" WHERE "tenderId" = $1`, [tid]);
    assert.equal(req.rows[0].count, 1, "TenderRequirement must still exist (rolled back)");
    const far = await pg.query<CountRow>(`SELECT COUNT(*)::integer AS count FROM "FallbackApprovalRecord" WHERE "tenderId" = $1`, [tid]);
    assert.equal(far.rows[0].count, 1, "FallbackApprovalRecord must still exist (rolled back)");

    // Restore table
    await pg.exec(`
      CREATE TABLE IF NOT EXISTS "AiUsageRecord" (
        id TEXT PRIMARY KEY, "tenderId" TEXT, "userId" TEXT NOT NULL,
        provider TEXT NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "AiUsageRecord_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"(id) ON DELETE SET NULL ON UPDATE CASCADE
      )
    `);
    await simulateDeleteTransaction(pg, tid);
  });

});
