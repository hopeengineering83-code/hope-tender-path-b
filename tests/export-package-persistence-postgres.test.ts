import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { prisma, prismaReady } from "../lib/prisma";
import { persistVerifiedExportPackageDownload } from "../lib/engine/export-package-persistence";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

let userId = "";
let otherUserId = "";
let tenderId = "";

function hash(label: string): string {
  return createHash("sha256").update(label).digest("hex");
}

function snapshot(packageSha256: string, suffix: string) {
  return {
    tenderId,
    userId,
    fileListJson: JSON.stringify([`${suffix}.zip`]),
    manifestJson: JSON.stringify([{ filename: `${suffix}.docx`, envelope: suffix.toUpperCase() }]),
    packageSha256,
    packageByteLength: 128 + suffix.length,
  };
}

describe("verified export package persistence", () => {
  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.user.create({
      data: { email: `export-owner-${nonce}@example.test`, passwordHash: "test", name: "Export Owner" },
    });
    const other = await prisma.user.create({
      data: { email: `export-other-${nonce}@example.test`, passwordHash: "test", name: "Other Owner" },
    });
    userId = user.id;
    otherUserId = other.id;
    const tender = await prisma.tender.create({
      data: { userId, title: `Export package ${nonce}`, status: "APPROVED", stage: "FINAL_REVIEW" },
    });
    tenderId = tender.id;
  });

  after(async () => {
    await prisma.exportPackage.deleteMany({ where: { tenderId } });
    await prisma.tender.deleteMany({ where: { id: tenderId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("atomically persists a verified snapshot and moves the owned tender to EXPORTED", async () => {
    const result = await persistVerifiedExportPackageDownload(prisma, snapshot(hash("combined"), "combined"));
    assert.equal(result.status, "READY");
    assert.equal(result.downloadCount, 1);
    assert.equal(result.integrityStatus, "VERIFIED");
    const tender = await prisma.tender.findUniqueOrThrow({ where: { id: tenderId }, select: { status: true, stage: true } });
    assert.deepEqual(tender, { status: "EXPORTED", stage: "EXPORT" });
  });

  it("serializes concurrent identical downloads into one snapshot with an exact count", async () => {
    const packageSha256 = hash("technical");
    await Promise.all(Array.from({ length: 4 }, () =>
      persistVerifiedExportPackageDownload(prisma, snapshot(packageSha256, "technical")),
    ));
    const rows = await prisma.exportPackage.findMany({ where: { tenderId, packageSha256 } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.downloadCount, 4);
  });

  it("preserves different envelope archives as separate immutable package snapshots", async () => {
    await persistVerifiedExportPackageDownload(prisma, snapshot(hash("financial"), "financial"));
    const rows = await prisma.exportPackage.findMany({
      where: { tenderId, packageSha256: { in: [hash("technical"), hash("financial")] } },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0]?.packageSha256, rows[1]?.packageSha256);
    assert.ok(rows.some((row) => row.manifestJson?.includes("TECHNICAL")));
    assert.ok(rows.some((row) => row.manifestJson?.includes("FINANCIAL")));
  });

  it("rejects a foreign tenant without writing package or lifecycle state", async () => {
    const beforeCount = await prisma.exportPackage.count({ where: { tenderId } });
    await assert.rejects(
      persistVerifiedExportPackageDownload(prisma, { ...snapshot(hash("foreign"), "foreign"), userId: otherUserId }),
      /TENDER_NOT_FOUND_OR_NOT_OWNED/,
    );
    assert.equal(await prisma.exportPackage.count({ where: { tenderId } }), beforeCount);
  });

  it("fails closed on invalid package integrity inputs", async () => {
    await assert.rejects(
      persistVerifiedExportPackageDownload(prisma, { ...snapshot("not-a-hash", "bad"), packageByteLength: 0 }),
      /INVALID_EXPORT_PACKAGE_SHA256|INVALID_EXPORT_PACKAGE_BYTE_LENGTH/,
    );
  });
});
