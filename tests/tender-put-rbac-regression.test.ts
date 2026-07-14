import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Regression test for vertical privilege escalation on PUT /api/tenders/[id].
 *
 * Before the fix, the PUT handler called getSession() (userId only) and
 * accepted ANY authenticated role — including VIEWER (read-only) and
 * REVIEWER (no TENDER_UPDATE permission). This allowed a VIEWER to edit
 * tender metadata, change the title, alter the deadline, etc.
 *
 * The DELETE handler on the same file already used requireRole("ADMIN",
 * "PROPOSAL_MANAGER"). The PUT handler was inconsistent.
 *
 * Exploit scenario (pre-fix):
 *   1. Attacker has a VIEWER account (lowest privilege).
 *   2. Attacker calls PUT /api/tenders/{victim-tender-id} with
 *      { "title": "Hacked" } and their own session cookie.
 *   3. getSession() returns the attacker's userId.
 *   4. findFirst({ where: { id, userId } }) returns null (not their tender).
 *      → 404. (tenant isolation held, but only because of the userId filter)
 *   5. If the attacker owned the tender, they could mutate it despite VIEWER
 *      role — a vertical privilege escalation within their own tenant.
 *
 * The fix mirrors the DELETE handler: requireRole("ADMIN", "PROPOSAL_MANAGER").
 */

test("PUT /api/tenders/[id] enforces requireRole (regression: VIEWER could mutate)", () => {
  const routePath = path.join(
    process.cwd(),
    "app/api/tenders/[id]/route.ts"
  );
  const src = fs.readFileSync(routePath, "utf8");

  // Find the PUT handler.
  const putIdx = src.indexOf("export async function PUT(");
  assert.ok(putIdx > -1, "PUT handler must exist");

  // Find the DELETE handler (for comparison — it's the known-correct pattern).
  const deleteIdx = src.indexOf("export async function DELETE(");
  assert.ok(deleteIdx > -1, "DELETE handler must exist");

  const putBody = src.slice(putIdx, deleteIdx);

  // The PUT handler must call requireRole with ADMIN and PROPOSAL_MANAGER.
  assert.ok(
    putBody.includes('requireRole("ADMIN", "PROPOSAL_MANAGER")') ||
    putBody.includes("requireRole('ADMIN', 'PROPOSAL_MANAGER')"),
    "PUT handler must call requireRole('ADMIN', 'PROPOSAL_MANAGER') — " +
    "previously it called getSession() (userId only) which allowed VIEWER/REVIEWER " +
    "to mutate tenders (vertical privilege escalation)."
  );

  // The PUT handler must NOT use getSession() as its auth check.
  // The old code had `const userId = await getSession();` as the first line.
  // The new code uses `requireRole(...)` which returns a role-aware actor.
  // We verify that getSession() is NOT called as an auth guard in the PUT
  // handler body (comments mentioning it are fine, but no live call).
  const putBodyLines = putBody.split("\n");
  const liveGetSessionCalls = putBodyLines.filter(
    (line) =>
      !line.trim().startsWith("//") &&
      !line.trim().startsWith("*") &&
      line.includes("getSession()") &&
      !line.includes("await getSession()") === false // matches `= await getSession()`
  );
  // The PUT handler should not have `= await getSession()` as its auth line.
  const hasLiveGetSessionAuth = putBodyLines.some(
    (line) =>
      !line.trim().startsWith("//") &&
      !line.trim().startsWith("*") &&
      /=\s*await\s+getSession\(\)/.test(line)
  );
  assert.ok(
    !hasLiveGetSessionAuth,
    "PUT handler must NOT use `= await getSession()` as its auth check — " +
    "getSession returns a userId only (no role). Use requireRole() instead. " +
    "(Found a live getSession() call in the PUT handler body.)"
  );
});

test("DELETE /api/tenders/[id] still enforces requireRole (no regression)", () => {
  const routePath = path.join(
    process.cwd(),
    "app/api/tenders/[id]/route.ts"
  );
  const src = fs.readFileSync(routePath, "utf8");

  const deleteIdx = src.indexOf("export async function DELETE(");
  assert.ok(deleteIdx > -1, "DELETE handler must exist");
  const deleteBody = src.slice(deleteIdx);

  assert.ok(
    deleteBody.includes('requireRole("ADMIN", "PROPOSAL_MANAGER")') ||
    deleteBody.includes("requireRole('ADMIN', 'PROPOSAL_MANAGER')"),
    "DELETE handler must still call requireRole('ADMIN', 'PROPOSAL_MANAGER')"
  );
});
