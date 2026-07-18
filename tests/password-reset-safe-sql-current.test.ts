import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const reset = read("lib/secure-password-reset.ts");
const forgot = read("app/api/auth/forgot-password/route.ts");

describe("password reset SQL safety", () => {
  it("contains no unsafe raw SQL in either account-recovery path", () => {
    assert.doesNotMatch(reset, /\$queryRawUnsafe|\$executeRawUnsafe/);
    assert.doesNotMatch(forgot, /\$queryRawUnsafe|\$executeRawUnsafe/);
  });

  it("uses Prisma tagged parameterization for every token value", () => {
    assert.match(reset, /tx\.\$queryRaw<ResetRow\[\]>`[\s\S]*\$\{tokenHash\}[\s\S]*FOR UPDATE/);
    assert.match(reset, /tx\.\$executeRaw`[\s\S]*\$\{row\.id\}/);
    assert.match(reset, /tx\.\$executeRaw`[\s\S]*\$\{row\.userId\}[\s\S]*\$\{row\.id\}/);
    assert.match(forgot, /tx\.\$executeRaw`[\s\S]*\$\{user\.id\}/);
    assert.match(forgot, /VALUES \(\$\{tokenId\}, \$\{user\.id\}, \$\{tokenHash\}, \$\{expiresAt\}, NOW\(\)\)/);
    assert.match(forgot, /prisma\.\$executeRaw`[\s\S]*\$\{tokenId\}/);
  });
});

describe("password reset one-time and privacy semantics", () => {
  it("keeps token locking, centralized classification, conditional consumption, password change, and session revocation in one transaction", () => {
    assert.match(reset, /prisma\.\$transaction\(async \(tx\) => \{/);
    assert.match(reset, /FOR UPDATE/);
    assert.match(reset, /const tokenState = classifyPasswordResetToken\(row\)/);
    assert.match(reset, /tokenState !== "ACTIVE"/);
    assert.match(reset, /WHERE "id" = \$\{row\.id\} AND "consumedAt" IS NULL/);
    assert.match(reset, /tx\.user\.update/);
    assert.match(reset, /tx\.session\.deleteMany/);
  });

  it("replaces prior active tokens atomically before issuing the new token", () => {
    assert.match(forgot, /prisma\.\$transaction\(async \(tx\) => \{/);
    const deletePos = forgot.indexOf('DELETE FROM "PasswordResetToken"');
    const insertPos = forgot.indexOf('INSERT INTO "PasswordResetToken"');
    assert.ok(deletePos >= 0 && insertPos > deletePos);
    assert.match(forgot, /"consumedAt" IS NULL/);
  });

  it("removes an undelivered token and preserves the generic anti-enumeration response", () => {
    assert.match(forgot, /if \(!delivery\.delivered\)/);
    assert.match(forgot, /WHERE "id" = \$\{tokenId\}/);
    assert.match(forgot, /If that email is registered/);
    // The forgot-password route now uses a timing-safe guard for non-existent
    // users instead of returning immediately. Verify it still returns GENERIC_RESPONSE.
    assert.match(forgot, /return NextResponse\.json\(GENERIC_RESPONSE/);
  });
});
