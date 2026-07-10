// Release acceptance — Work Package D.1-3 (cross-user tender isolation).
//
// requireTenderAccess is the ownership guard behind tender read/mutate/download.
// A user must never reach another user's tender; only ADMIN may fall back to a
// global lookup. This exercises the REAL helper against a real database.
//
// Requires RUN_DB_INTEGRATION=true and an isolated PostgreSQL. Skips cleanly
// otherwise.

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
const dbDescribe = RUN_DB ? describe : describe.skip;

dbDescribe("release-acceptance D — requireTenderAccess cross-user isolation", () => {
  const { prisma } = require("../lib/prisma");
  const { requireTenderAccess } = require("../lib/tender-ownership");

  const suffix = Date.now().toString(36);
  const ownerId = `own-${suffix}`;
  const otherId = `oth-${suffix}`;
  const adminId = `adm-${suffix}`;
  const tenderId = `ten-${suffix}`;

  before(async () => {
    for (const [id, role] of [[ownerId, "PROPOSAL_MANAGER"], [otherId, "PROPOSAL_MANAGER"], [adminId, "ADMIN"]] as const) {
      await prisma.user.create({ data: { id, email: `${id}@test.local`, name: id, passwordHash: "$2a$10$test", role } });
    }
    await prisma.tender.create({ data: { id: tenderId, userId: ownerId, title: "Owner Tender", status: "DRAFT", stage: "TENDER_INTAKE" } });
  });

  after(async () => {
    await prisma.tender.deleteMany({ where: { id: tenderId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId, adminId] } } }).catch(() => {});
  });

  it("grants the owner access to their own tender", async () => {
    const t = await requireTenderAccess(tenderId, ownerId, "PROPOSAL_MANAGER");
    assert.ok(t, "owner can access");
    assert.equal(t.id, tenderId);
  });

  it("BLOCKS a different non-admin user (cross-tenant) — returns null", async () => {
    const t = await requireTenderAccess(tenderId, otherId, "PROPOSAL_MANAGER");
    assert.equal(t, null, "another PROPOSAL_MANAGER cannot reach the owner's tender");
  });

  it("BLOCKS a REVIEWER from another user's tender", async () => {
    const t = await requireTenderAccess(tenderId, otherId, "REVIEWER");
    assert.equal(t, null);
  });

  it("allows ADMIN to fall back to a global lookup (support/admin path)", async () => {
    const t = await requireTenderAccess(tenderId, adminId, "ADMIN");
    assert.ok(t, "admin may access via fallback");
    assert.equal(t.id, tenderId);
  });

  it("returns null for a non-existent tender id (no information leak)", async () => {
    const t = await requireTenderAccess("does-not-exist", ownerId, "PROPOSAL_MANAGER");
    assert.equal(t, null);
  });
});
