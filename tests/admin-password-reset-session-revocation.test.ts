import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Regression test for the session-survives-password-reset bug.
 *
 * Before the fix, when an admin changed a user's password via
 * PUT /api/users/[id], the user's existing Session rows were NOT destroyed.
 * A stolen session cookie remained valid for up to SESSION_TTL_DAYS (14 days)
 * after the password was reset — defeating the purpose of the reset.
 *
 * ROUND-2 STRENGTHENING: The initial fix called destroyAllSessions() AFTER
 * prisma.user.update, OUTSIDE any transaction. If the DB had a transient
 * failure between the two, the password was changed but sessions survived.
 * The atomic fix wraps BOTH operations in prisma.$transaction so they
 * succeed or fail together.
 *
 * Exploit scenario (pre-fix):
 *   1. Attacker steals a user's session cookie (XSS, shared computer).
 *   2. Victim notices, asks admin to reset their password.
 *   3. Admin resets password via PUT /api/users/[id].
 *   4. Victim's password is changed — but the stolen cookie still works.
 *   5. Attacker continues to access the account for up to 14 days.
 *
 * Exploit scenario (non-atomic fix, before round-2 strengthening):
 *   1-4 as above.
 *   5. DB has a transient blip between user.update and destroyAllSessions.
 *   6. Password is changed, but sessions survive. Attacker still has access.
 */

test("PUT /api/users/[id] destroys all sessions ATOMICALLY when password is changed", () => {
  const routePath = path.join(
    process.cwd(),
    "app/api/users/[id]/route.ts"
  );
  const src = fs.readFileSync(routePath, "utf8");

  // Find the PUT handler body.
  const putIdx = src.indexOf("export async function PUT(");
  assert.ok(putIdx > -1, "PUT handler must exist");
  const deleteIdx = src.indexOf("export async function DELETE(");
  const putBody = src.slice(putIdx, deleteIdx > -1 ? deleteIdx : undefined);

  // MUST use prisma.$transaction — NOT a bare destroyAllSessions() call.
  // The non-transactional approach has a race: if the DB fails between
  // user.update and session.deleteMany, the password is changed but
  // sessions survive.
  assert.ok(
    putBody.includes("prisma.$transaction"),
    "PUT /api/users/[id] must wrap user.update + session.deleteMany in prisma.$transaction " +
    "so the password change and session revocation are atomic. " +
    "The non-transactional approach (destroyAllSessions after update) has a " +
    "race condition where a DB failure leaves sessions alive."
  );

  // MUST call tx.session.deleteMany inside the transaction.
  assert.ok(
    putBody.includes("tx.session.deleteMany"),
    "PUT /api/users/[id] must call tx.session.deleteMany INSIDE the transaction " +
    "(not destroyAllSessions outside it)."
  );

  // The session deletion must be conditional on `password` being set
  // (we don't want to nuke all sessions on a name-only update).
  assert.ok(
    putBody.includes("if (password)"),
    "session.deleteMany must be called only when a password is actually changed"
  );

  // MUST NOT use the non-atomic destroyAllSessions pattern (the old fix).
  // If destroyAllSessions appears in the PUT body, it means the non-atomic
  // pattern is still present.
  const hasNonAtomicDestroy = putBody.includes("await destroyAllSessions(");
  assert.ok(
    !hasNonAtomicDestroy,
    "PUT /api/users/[id] must NOT call destroyAllSessions() directly (non-atomic). " +
    "Use tx.session.deleteMany inside prisma.$transaction instead."
  );

  // MUST have error handling that returns 500 on transaction failure
  // (so the client knows the password was NOT changed).
  assert.ok(
    putBody.includes("catch") && putBody.includes("500"),
    "PUT /api/users/[id] must catch transaction failures and return 500 " +
    "so the client knows the password was NOT changed."
  );
});
