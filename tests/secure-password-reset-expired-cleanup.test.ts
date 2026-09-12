// Real bug: the non-ACTIVE branch of handleSecurePasswordReset used to
// `throw new Error("INVALID_RESET_TOKEN")` from INSIDE prisma.$transaction
// after opportunistically running `UPDATE "PasswordResetToken" SET
// "consumedAt" = NOW() ...` for an EXPIRED token. Prisma rolls back every
// statement executed through the transaction's `tx` client (including raw
// queries) when the callback throws, so that UPDATE never actually
// committed — an expired token's consumedAt stayed NULL forever. The fix
// (lib/secure-password-reset.ts) returns normally from the transaction and
// decides the HTTP response afterward from a captured tokenState, so the
// cleanup UPDATE actually persists.
//
// This is proven end-to-end against real PostgreSQL rather than by source
// inspection, since the whole point is that a *rolled-back* transaction
// looks identical to a *committed* one from the outside (same 400
// response) — only the persisted row state tells them apart.

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { prisma, prismaReady } from "../lib/prisma";
import { hashResetToken } from "../lib/reset-token";
import { handleSecurePasswordReset } from "../lib/secure-password-reset";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

// getClientIp() only trusts x-forwarded-for when TRUST_PROXY/VERCEL(_ENV) is
// set; otherwise every request collapses onto the same "unknown" rate-limit
// bucket, which real, unrelated password-reset traffic would also share.
// Set it so each test gets its own per-request client-scoped bucket instead
// of tripping PASSWORD_RESET_RATE_LIMIT (5 per 15 minutes) against whatever
// else has hit this bucket in the same disposable database.
process.env.TRUST_PROXY = "true";

function resetRequest(token: string, password: string): Request {
  return new Request("https://example.test/api/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${randomBytes(4).toString("hex")}` },
    body: JSON.stringify({ token, password }),
  });
}

describe("handleSecurePasswordReset — expired-token cleanup actually commits (real PostgreSQL)", () => {
  let userId: string;

  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.user.create({
      data: { email: `password-reset-expired-${nonce}@example.test`, name: "Password Reset Expired Test", passwordHash: "test-hash" },
    });
    userId = user.id;
  });

  after(async () => {
    await prisma.passwordResetToken.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("marks an expired token consumed even though the request is correctly rejected", async () => {
    const token = `expired-token-${Math.random().toString(16).slice(2)}`;
    const tokenHash = hashResetToken(token);
    const created = await prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() - 60_000), // already expired
        consumedAt: null,
      },
    });

    const response = await handleSecurePasswordReset(resetRequest(token, "A-New-Str0ng-Passw0rd!"));
    assert.equal(response.status, 400, "an expired token must be rejected");
    const body = await response.json() as { error?: string };
    assert.match(body.error ?? "", /invalid or expired/i);

    const row = await prisma.passwordResetToken.findUnique({ where: { id: created.id } });
    assert.ok(row, "the token row must still exist");
    assert.ok(row?.consumedAt, "the expired token's consumedAt must actually be persisted, not rolled back");

    const userAfter = await prisma.user.findUnique({ where: { id: userId } });
    assert.equal(userAfter?.passwordHash, "test-hash", "an expired token must never change the password");
  });

  it("still accepts a genuinely ACTIVE token and consumes it", async () => {
    const token = `active-token-${Math.random().toString(16).slice(2)}`;
    const tokenHash = hashResetToken(token);
    const created = await prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        consumedAt: null,
      },
    });

    const response = await handleSecurePasswordReset(resetRequest(token, "Another-Str0ng-Passw0rd!"));
    assert.equal(response.status, 200);

    const row = await prisma.passwordResetToken.findUnique({ where: { id: created.id } });
    assert.ok(row?.consumedAt, "an active, successfully-used token must be marked consumed");

    const userAfter = await prisma.user.findUnique({ where: { id: userId } });
    assert.notEqual(userAfter?.passwordHash, "test-hash", "a successful reset must change the password hash");
  });
});
