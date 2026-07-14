import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Regression test for the session-survives-password-reset bug.
 *
 * Before the fix, when an admin changed a user's password via
 * PUT /api/users/[id], the user's existing Session rows were NOT destroyed.
 * This meant a stolen session cookie remained valid for up to
 * SESSION_TTL_DAYS (14 days) after the password was reset — defeating
 * the purpose of the reset.
 *
 * The token-based password-reset flow (forgot-password → reset) already
 * called tx.session.deleteMany inside its transaction. The admin/user PUT
 * path was missing this step.
 *
 * Exploit scenario (pre-fix):
 *   1. Attacker steals a user's session cookie (e.g., via XSS on a
 *      subdomain, or by accessing a shared computer).
 *   2. Victim notices, asks admin to reset their password.
 *   3. Admin resets password via PUT /api/users/[id].
 *   4. Victim's password is changed — but the stolen cookie still works.
 *   5. Attacker continues to access the account for up to 14 days.
 *
 * The fix calls destroyAllSessions(id) after the password update.
 */

test("PUT /api/users/[id] destroys all sessions when password is changed", () => {
  const routePath = path.join(
    process.cwd(),
    "app/api/users/[id]/route.ts"
  );
  const src = fs.readFileSync(routePath, "utf8");

  // Must import destroyAllSessions from lib/auth.
  assert.ok(
    src.includes("destroyAllSessions"),
    "PUT /api/users/[id] must import and use destroyAllSessions — " +
    "previously a stolen session cookie survived an admin password reset " +
    "for up to SESSION_TTL_DAYS."
  );

  // Find the PUT handler body.
  const putIdx = src.indexOf("export async function PUT(");
  assert.ok(putIdx > -1, "PUT handler must exist");
  const deleteIdx = src.indexOf("export async function DELETE(");
  const putBody = src.slice(putIdx, deleteIdx > -1 ? deleteIdx : undefined);

  // The destroyAllSessions call must be conditional on `password` being set
  // (we don't want to nuke all sessions on a name-only update).
  assert.ok(
    putBody.includes("if (password)"),
    "destroyAllSessions must be called only when a password is actually changed"
  );

  // The destroyAllSessions call must be AFTER the prisma.user.update.
  const updateIdx = putBody.indexOf("prisma.user.update(");
  const destroyIdx = putBody.indexOf("destroyAllSessions(");
  assert.ok(
    updateIdx > -1 && destroyIdx > -1 && updateIdx < destroyIdx,
    "destroyAllSessions must be called AFTER prisma.user.update " +
    "(the password must be changed before sessions are revoked)"
  );
});
