import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { classifyPasswordResetToken, type ResetRow } from "../lib/secure-password-reset";

function row(overrides: Partial<ResetRow> = {}): ResetRow {
  return {
    id: "reset-token-id",
    userId: "user-id",
    expiresAt: new Date("2026-07-18T12:20:00.000Z"),
    consumedAt: null,
    ...overrides,
  };
}

describe("password reset token policy", () => {
  const now = new Date("2026-07-18T12:00:00.000Z");

  it("classifies only unconsumed, unexpired rows as active", () => {
    assert.equal(classifyPasswordResetToken(row(), now), "ACTIVE");
    assert.equal(classifyPasswordResetToken(null, now), "MISSING");
    assert.equal(classifyPasswordResetToken(undefined, now), "MISSING");
    assert.equal(classifyPasswordResetToken(row({ consumedAt: new Date("2026-07-18T11:00:00.000Z") }), now), "CONSUMED");
    assert.equal(classifyPasswordResetToken(row({ expiresAt: new Date("2026-07-18T12:00:00.000Z") }), now), "EXPIRED");
    assert.equal(classifyPasswordResetToken(row({ expiresAt: new Date("2026-07-18T11:59:59.999Z") }), now), "EXPIRED");
  });

  it("keeps expiry fail-closed and revokes expired rows before returning the sanitized invalid response", () => {
    // The non-ACTIVE branch must NOT throw inside prisma.$transaction: Prisma
    // rolls back every statement executed through `tx` (including raw
    // queries) when the interactive-transaction callback throws, so a throw
    // here would silently discard the "mark this expired token consumed"
    // UPDATE below it and it would never actually commit. The transaction
    // must instead return normally so that cleanup persists, with the
    // caller deciding the HTTP response from `tokenState` afterward.
    const source = readFileSync("lib/secure-password-reset.ts", "utf8");
    assert.match(source, /const tokenState = classifyPasswordResetToken\(row\)/);
    assert.match(source, /if \(tokenState !== "ACTIVE"\)/);
    assert.match(source, /tokenState === "EXPIRED"/);
    assert.match(source, /UPDATE "PasswordResetToken"[\s\S]*SET "consumedAt" = NOW\(\)[\s\S]*WHERE "id" = \$\{row\.id\} AND "consumedAt" IS NULL/);
    assert.doesNotMatch(source, /throw new Error\("INVALID_RESET_TOKEN"\)/, "the non-ACTIVE branch must return normally, not throw, so its cleanup UPDATE commits instead of being rolled back");
    assert.match(source, /if \(outcome\.tokenState !== "ACTIVE"\) \{\s*return NextResponse\.json\(invalidReset, \{ status: 400 \}\);/);
  });

  it("consumes the accepted token, deletes sibling tokens, and revokes sessions inside the same transaction", () => {
    const source = readFileSync("lib/secure-password-reset.ts", "utf8");
    assert.match(source, /await prisma\.\$transaction\(async \(tx\) => \{/);
    assert.match(source, /FOR UPDATE/);
    assert.match(source, /SET "consumedAt" = NOW\(\)[\s\S]*WHERE "id" = \$\{row\.id\} AND "consumedAt" IS NULL/);
    assert.match(source, /DELETE FROM "PasswordResetToken"[\s\S]*WHERE "userId" = \$\{row\.userId\} AND "id" <> \$\{row\.id\}/);
    assert.match(source, /tx\.session\.deleteMany\(\{ where: \{ userId: row\.userId \} \}\)/);
  });
});
