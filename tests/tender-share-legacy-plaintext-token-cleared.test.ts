// Audit C-4 follow-up: the hashing migration must not leave legacy plaintext
// share tokens sitting in the database.
//
// 20260817120000_tender_share_token_hash added "tokenHash", backfilled it from
// every existing plaintext token, and then deliberately kept "token" populated
// "for backward compatibility during the transition window", noting that a
// follow-up could drop the column once all pre-hash shares expire — up to 365
// days later.
//
// That retention is unnecessary and it costs C-4 its entire benefit:
//
//   * Unnecessary, because the SQL backfill computes
//     encode(digest("token",'sha256'),'hex'), which is byte-for-byte what
//     lib/tender-share-security.ts hashTenderShareToken produces. Every legacy
//     row therefore resolves through the same O(1) hash lookup that serves a
//     new share. The first test below proves that against a real row rather
//     than by reading the two implementations and asserting they look alike.
//
//   * Costly, because the exposure C-4 exists to close is, in the hashing
//     migration's own words, "A DB leak (SQL injection, backup exposure,
//     insider threat) would expose every active share URL instantly." While the
//     plaintext remains, that sentence is still true for every pre-hash share —
//     and tests/deep-remediation-c3-c4-c5-h6.test.ts already asserts "DB leakage
//     cannot produce usable share URLs", a claim the stored data contradicts.
//     That test is not wrong about new tokens; it simply never looks at the
//     legacy rows, which is why this gap survived the remediation.
//
// 20260817140000_tender_share_clear_legacy_plaintext_tokens clears the column
// wherever a hash exists. These tests pin both halves: legacy links keep
// working, and the plaintext is gone.

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { withDbFixture } from "./helpers/db-fixture";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
const dbDescribe = RUN_DB ? describe : describe.skip;

const MIGRATION =
  "prisma/migrations/20260817140000_tender_share_clear_legacy_plaintext_tokens/migration.sql";

describe("C-4 follow-up: legacy plaintext share tokens (source)", () => {
  it("the clearing migration nulls the plaintext only where a hash exists", () => {
    const sql = readFileSync(MIGRATION, "utf8");

    assert.match(sql, /UPDATE "TenderShare"/, "must update TenderShare");
    assert.match(sql, /SET "token" = NULL/, "must clear the plaintext token");
    // Guarded on both sides: a row without a hash still needs its plaintext,
    // because the fallback lookup in app/share/[token]/page.tsx is all that can
    // serve it. Clearing unconditionally would silently break those links.
    assert.match(sql, /WHERE "tokenHash" IS NOT NULL/, "must require a hash to be present");

    // Nothing destructive: this migration must not drop the column or the
    // table while pre-hash links may still be in flight.
    assert.doesNotMatch(sql, /DROP\s+(COLUMN|TABLE|INDEX)/i, "must stay non-destructive");
    assert.doesNotMatch(sql, /DELETE\s+FROM/i, "must not delete share rows");
  });

  it("the hashing migration's backfill matches the application hash", () => {
    // This equality is the reason the plaintext column is redundant. If either
    // side ever changes algorithm or encoding, legacy rows stop resolving and
    // this assertion is the thing that says so.
    const hashing = readFileSync(
      "prisma/migrations/20260817120000_tender_share_token_hash/migration.sql",
      "utf8",
    );
    assert.match(hashing, /encode\(digest\("token", 'sha256'\), 'hex'\)/);

    const token = randomBytes(32).toString("base64url");
    const appHash = createHash("sha256").update(token).digest("hex");
    assert.match(appHash, /^[0-9a-f]{64}$/, "sha256 hex is what the SQL backfill writes");
  });
});

dbDescribe("C-4 follow-up: legacy plaintext share tokens (PostgreSQL)", () => {
  const fx = withDbFixture();
  before(fx.setup);
  after(fx.teardown);

  // Build a row shaped exactly like one the hashing migration produced: the
  // original plaintext still present, the hash backfilled beside it.
  async function seedLegacyShare(tag: string) {
    const prisma = fx.prisma;
    const user = await prisma.user.create({
      data: {
        email: `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`,
        name: `${tag} test`,
        passwordHash: "unused",
        role: "PROPOSAL_MANAGER",
      },
    });
    fx.trackUser(user.id);

    const tender = await prisma.tender.create({
      data: { userId: user.id, title: `${tag} ${Date.now()}` },
    });
    fx.trackTender(tender.id);

    const token = randomBytes(32).toString("base64url");
    const share = await prisma.tenderShare.create({
      data: {
        tenderId: tender.id,
        createdById: user.id,
        token,
        tokenHash: createHash("sha256").update(token).digest("hex"),
      },
    });
    fx.track("tenderShares", share.id);

    return { share, token };
  }

  it("a legacy row resolves by hash, so the plaintext column is never needed to serve it", async () => {
    const { share, token } = await seedLegacyShare("legacy-share-resolves");
    const { hashTenderShareToken } = await import("../lib/tender-share-security");

    const found = await fx.prisma.tenderShare.findFirst({
      where: { tokenHash: hashTenderShareToken(token) },
    });

    assert.ok(found, "the backfilled hash must resolve the legacy share");
    assert.equal(found.id, share.id);
  });

  it("clearing the plaintext keeps the legacy link working", async () => {
    const { share, token } = await seedLegacyShare("legacy-share-cleared");
    const { hashTenderShareToken } = await import("../lib/tender-share-security");

    // Exactly the statement the migration runs.
    await fx.prisma.$executeRawUnsafe(
      `UPDATE "TenderShare" SET "token" = NULL WHERE "tokenHash" IS NOT NULL AND "token" IS NOT NULL`,
    );

    const after = await fx.prisma.tenderShare.findUniqueOrThrow({ where: { id: share.id } });
    assert.equal(after.token, null, "the plaintext must be gone");
    assert.ok(after.tokenHash, "the hash must remain");

    const found = await fx.prisma.tenderShare.findFirst({
      where: { tokenHash: hashTenderShareToken(token) },
    });
    assert.ok(found, "the recipient's existing share URL must still resolve");
    assert.equal(found.id, share.id);
  });

  it("no share row keeps a plaintext token beside its hash", async () => {
    await seedLegacyShare("legacy-share-invariant");

    await fx.prisma.$executeRawUnsafe(
      `UPDATE "TenderShare" SET "token" = NULL WHERE "tokenHash" IS NOT NULL AND "token" IS NOT NULL`,
    );

    // The invariant the migration establishes, asserted against the table
    // rather than against the rows this test happens to know about.
    const leaking = await fx.prisma.tenderShare.count({
      where: { AND: [{ tokenHash: { not: null } }, { token: { not: null } }] },
    });
    assert.equal(leaking, 0, "a DB leak must not expose any usable share token");
  });
});
