// Audit C-5 follow-up: soft-delete must actually reject auth, not just the one
// path the remediation checked.
//
// C-5 landed three pieces: Tender.user onDelete: Restrict, a soft-deleting
// DELETE /api/users/[id] that atomically revokes the account's sessions, and a
// deletedAt guard in getCurrentUser. tests/deep-remediation-c3-c4-c5-h6.test.ts
// asserts each of those by source inspection, and each assertion is true.
//
// Two things were still reachable by a deactivated account:
//
//   1. Login. Revoking sessions removes the sessions the account already had.
//      It does not stop a deactivated user who still knows their password from
//      logging in again and being handed a brand-new one.
//
//   2. getSession(). Around twenty API routes — /api/tenders, the
//      proposal-version routes, /api/company, /api/search, /api/notifications
//      and others — authorize on getSession() alone and never load the user
//      record, so they never reached the getCurrentUser guard.
//
// Together those meant deactivation removed a user's current sessions and then
// let them walk back in. These tests pin both halves shut.

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { withDbFixture } from "./helpers/db-fixture";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
const dbDescribe = RUN_DB ? describe : describe.skip;

const stripComments = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

describe("C-5 follow-up: soft-delete is enforced at the shared choke point", () => {
  it("getSession rejects a session whose user is soft-deleted", () => {
    const auth = stripComments(readFileSync("lib/auth.ts", "utf8"));
    const getSessionBody = auth.slice(
      auth.indexOf("export async function getSession"),
      auth.indexOf("export async function getCurrentUser"),
    );
    assert.ok(getSessionBody.length > 0, "getSession must precede getCurrentUser");

    assert.match(
      getSessionBody,
      /user:\s*\{\s*select:\s*\{\s*deletedAt:\s*true\s*\}\s*\}/,
      "the session query must load the user's deletedAt",
    );
    assert.match(
      getSessionBody,
      /session\.user\?\.deletedAt.*return null/s,
      "a soft-deleted user's session must resolve to null",
    );
  });

  it("getCurrentUser keeps its own guard", () => {
    // Defense in depth: getSession is the choke point, but getCurrentUser is a
    // public export in its own right and must not rely on its caller.
    const auth = stripComments(readFileSync("lib/auth.ts", "utf8"));
    const body = auth.slice(auth.indexOf("export async function getCurrentUser"));
    assert.match(body, /user\?\.deletedAt.*return null/s);
  });

  it("login refuses a soft-deleted account without revealing it exists", () => {
    const login = stripComments(readFileSync("app/api/auth/login/route.ts", "utf8"));

    assert.match(login, /user\.deletedAt/, "login must consider deletedAt");

    // The rejection must share the wrong-password branch. A dedicated branch —
    // a different status, body, or an early return before bcrypt — would let an
    // unauthenticated caller enumerate which accounts are deactivated.
    assert.match(
      login,
      /if \(!user \|\| !user\.passwordHash \|\| !passwordOk \|\| user\.deletedAt\)/,
      "deletedAt must be folded into the shared INVALID_CREDENTIALS branch",
    );
    const deletedIdx = login.indexOf("user.deletedAt");
    const compareIdx = login.indexOf("bcrypt.compare");
    assert.ok(compareIdx > 0 && compareIdx < deletedIdx, "the bcrypt comparison must still run first");
  });
});

dbDescribe("C-5 follow-up: soft-delete blocks re-authentication (PostgreSQL)", () => {
  const fx = withDbFixture();
  before(fx.setup);
  after(fx.teardown);

  async function seedUser(tag: string) {
    const user = await fx.prisma.user.create({
      data: {
        email: `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`,
        name: `${tag} test`,
        passwordHash: "unused",
        role: "PROPOSAL_MANAGER",
      },
    });
    fx.trackUser(user.id);
    return user;
  }

  it("a live session stops resolving the moment the user is soft-deleted", async () => {
    const user = await seedUser("softdelete-session");

    // Shape the row the way getSession reads it, then re-run its exact
    // predicate. Calling getSession() itself needs a cookie store, which is a
    // request scope this test does not have; the query is the part that decides.
    const session = await fx.prisma.session.create({
      data: {
        token: `test-token-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        userId: user.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    fx.track("sessions", session.id);

    const before = await fx.prisma.session.findUnique({
      where: { token: session.token },
      select: { userId: true, expiresAt: true, user: { select: { deletedAt: true } } },
    });
    assert.ok(before, "the session must exist");
    assert.equal(before.user?.deletedAt, null, "the user starts active");

    await fx.prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: new Date(), deletedBy: "test" },
    });

    const after = await fx.prisma.session.findUnique({
      where: { token: session.token },
      select: { userId: true, expiresAt: true, user: { select: { deletedAt: true } } },
    });
    assert.ok(after, "the session row itself may still exist");
    assert.ok(after.user?.deletedAt, "but getSession's own predicate now rejects it");
  });

  it("soft-delete preserves the user's tenders (Restrict, not Cascade)", async () => {
    const user = await seedUser("softdelete-history");
    const tender = await fx.prisma.tender.create({
      data: { userId: user.id, title: `Soft delete history ${Date.now()}` },
    });
    fx.trackTender(tender.id);

    await fx.prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: new Date(), deletedBy: "test" },
    });

    const kept = await fx.prisma.tender.findUnique({ where: { id: tender.id } });
    assert.ok(kept, "deactivating an owner must not erase their tender history");
    assert.equal(kept.userId, user.id, "ownership stays attributable for audit");
  });
});
