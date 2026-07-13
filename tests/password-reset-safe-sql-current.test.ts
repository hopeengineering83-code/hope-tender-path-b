import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const read = (path: string) => readFileSync(path, "utf8");

const reset = read(join(rootDir, "lib/secure-password-reset.ts"));
const forgot = read(join(rootDir, "app/api/auth/forgot-password/route.ts"));

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
  it("keeps token locking, conditional consumption, password change, and session revocation in one transaction", () => {
    assert.match(reset, /prisma\.\$transaction\(async \(tx\) => \{/);
    assert.match(reset, /FOR UPDATE/);
    assert.match(reset, /row\.consumedAt/);
    assert.match(reset, /new Date\(row\.expiresAt\)\.getTime\(\) <= Date\.now\(\)/);
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
    assert.match(forgot, /if \(!user\) return NextResponse\.json\(GENERIC_RESPONSE/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Parameterized SQL, row locking, and one-time token semantics
// ─────────────────────────────────────────────────────────────────────────────

describe("password reset SQL safety — parameterized queries and token semantics", () => {
  it("uses parameterized queries ($queryRaw tagged template, not string interpolation)", () => {
    // The reset module must use $queryRaw`...` (tagged template) which
    // parameterizes values, NOT $queryRawUnsafe(string) which is vulnerable
    // to SQL injection.
    assert.doesNotMatch(reset, /\$queryRawUnsafe|\$executeRawUnsafe/);
    assert.doesNotMatch(forgot, /\$queryRawUnsafe|\$executeRawUnsafe/);
    // Must use parameterized tagged template literals (may have type param).
    assert.match(reset, /\$queryRaw/);
    assert.match(reset, /FOR UPDATE/);
  });

  it("uses row locking (FOR UPDATE) to prevent race conditions on token consumption", () => {
    // The reset flow must lock the token row during consumption to prevent
    // a double-use race where two concurrent requests use the same token.
    assert.match(reset, /FOR UPDATE/i);
  });

  it("enforces one-time token semantics — consumed tokens cannot be reused", () => {
    // The reset flow must mark tokens as consumed (consumedAt) and reject
    // requests with already-consumed tokens.
    assert.match(reset, /consumedAt/i);
    // The SET clause must check consumedAt IS NULL to prevent double-use.
    assert.match(reset, /"consumedAt" IS NULL/);
  });

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    const vercel = JSON.parse(read(join(rootDir, "vercel.json")));
    assert.equal(vercel.git?.deploymentEnabled, true);
  });
});
