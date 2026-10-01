/**
 * The UI may never say "Ready to download" for a package the download refuses.
 *
 * A live Preview showed the release status reporting ready while
 * GET /download?type=zip answered 409. Both surfaces read the same canonical
 * function, getFinalSubmissionReadiness, but they pass it different
 * requireFileContent values: the download passes true, every page-load surface
 * passes false to avoid pulling document blobs on a poll. That flag decides
 * whether the bytes are LOADED, which is what makes the byte and identity
 * checks possible — an obvious way for one function to return two answers.
 *
 * That asymmetry was investigated on this head and does NOT reproduce: the
 * byte/identity check runs regardless of the flag, and a document with no
 * bytes is refused under both. The flag now only decides whether ABSENT bytes
 * are additionally reported as their own failure, and export-readiness.ts
 * already documents that as a deliberate earlier fix. So no code was changed
 * for the old symptom.
 *
 * This is therefore a GUARD, not a fix: it pins the invariant in both
 * directions so that a future change which makes the two surfaces disagree
 * fails here rather than in front of an owner.
 *
 *   BLOCKED → UI blocked, download blocked
 *   READY   → UI ready, download ready
 *
 * Requires RUN_DB_INTEGRATION=true. Skips cleanly otherwise.
 */

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
const dbDescribe = RUN_DB ? describe : describe.skip;

dbDescribe("UI readiness and download readiness cannot disagree", () => {
  const { PrismaClient } = require("@prisma/client");
  const { randomUUID, createHash } = require("node:crypto");
  const { getFinalSubmissionReadiness } = require("../lib/engine/final-submission-readiness");

  const prisma = new PrismaClient();
  let userId = "";
  let tenderId = "";
  let documentId = "";

  /** How a page-load surface asks: cheap, no blobs loaded. */
  const asUi = () => getFinalSubmissionReadiness(prisma, { tenderId, userId });
  /** How GET /download?type=zip asks. */
  const asDownload = () =>
    getFinalSubmissionReadiness(prisma, { tenderId, userId, requireFileContent: true });

  before(async () => {
    const user = await prisma.user.create({
      data: {
        name: "Readiness Owner",
        email: `readiness-owner+${Date.now()}@example.test`,
        passwordHash: "x",
        role: "ADMIN",
      },
    });
    userId = user.id;
    await prisma.company.create({ data: { userId, name: "Readiness Works" } });
    const tender = await prisma.tender.create({
      data: { id: randomUUID(), userId, title: "Readiness RFP", status: "ACTIVE" },
    });
    tenderId = tender.id;

    // A document that looks export-ready by every status field but holds no
    // bytes — the shape that produced "Ready to download" beside a 409.
    const doc = await prisma.generatedDocument.create({
      data: {
        tenderId,
        name: "Technical Proposal",
        exactFileName: "Technical-Proposal.docx",
        exactOrder: 1,
        documentType: "TECHNICAL_PROPOSAL",
        format: "DOCX",
        generationStatus: "GENERATED",
        validationStatus: "VALIDATED",
        reviewStatus: "READY_FOR_EXPORT",
        fileContent: null,
        storagePath: null,
      },
    });
    documentId = doc.id;
  });

  after(async () => {
    if (tenderId) await prisma.generatedDocument.deleteMany({ where: { tenderId } }).catch(() => {});
    if (userId) await prisma.aiJob.deleteMany({ where: { userId } }).catch(() => {});
    if (tenderId) await prisma.tender.delete({ where: { id: tenderId } }).catch(() => {});
    if (userId) await prisma.company.deleteMany({ where: { userId } }).catch(() => {});
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect().catch(() => {});
  });

  it("agrees when the package is blocked", async () => {
    const [ui, download] = await Promise.all([asUi(), asDownload()]);
    assert.ok(ui && download);
    assert.equal(download.ok, false, "the download must refuse a package with no bytes");
    assert.equal(
      ui.ok,
      download.ok,
      `the UI must not claim readiness the download refuses — UI ${ui.ok}, download ${download.ok}`,
    );
  });

  it("never claims ready while the byte-strict verdict refuses", async () => {
    // This is the exact live symptom: status "ready to download", ZIP 409.
    const ui = await asUi();
    assert.equal(ui.ok, false);
  });

  it("agrees in both directions as the tender changes", async () => {
    // Give the document real bytes so the strict verdict has something to
    // verify, then re-ask both ways. Whatever the verdict becomes, the two
    // surfaces must reach it together.
    const bytes = Buffer.from("PK minimal docx stand-in for byte presence");
    const content = bytes.toString("base64");
    await prisma.generatedDocument.update({
      where: { id: documentId },
      data: {
        fileContent: content,
        contentSha256: createHash("sha256").update(bytes).digest("hex"),
        contentByteLength: bytes.byteLength,
        contentMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        integrityStatus: "VERIFIED",
      },
    });

    const [ui, download] = await Promise.all([asUi(), asDownload()]);
    assert.ok(ui && download);
    assert.equal(
      ui.ok,
      download.ok,
      `readiness must agree after the bytes exist — UI ${ui.ok}, download ${download.ok}`,
    );
    // And the blocker sets must describe the same package rather than two
    // different ones.
    assert.deepEqual(
      (ui.tenderLevelBlockers ?? []).map((b: { category?: string }) => b.category).sort(),
      (download.tenderLevelBlockers ?? []).map((b: { category?: string }) => b.category).sort(),
    );
  });
});
