/**
 * An addendum's deadline wins at RUNTIME, and names the document it came from.
 *
 * Requires RUN_DB_INTEGRATION=true and an isolated PostgreSQL instance.
 * Skips cleanly when RUN_DB_INTEGRATION is not set.
 *
 * The parser-level amendment matrix proves the reader resolves an extension.
 * It cannot prove the application does, because the application assembles the
 * text first: getEffectiveTenderFacts concatenates every ACTIVE file into one
 * string and hands that to the reader. This exercises the real resolver against
 * real rows, with the original notice and the addendum stored as two separate
 * source files, which is how a tender pack actually arrives.
 *
 * It also pins the audit answer. "Which document extended this deadline?" is an
 * ordinary question and had no answer: the flattening dropped file identity, so
 * the winning value arrived attached to nothing. The clause survives the
 * flattening and is enough to find the file again, so the fact now carries both
 * the quote and the file — recovered where the files are already in hand rather
 * than by threading identity through the reader and creating a second place
 * where source authority is decided.
 *
 * Nothing here is keyed to a benchmark; the tender is invented.
 */

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
const dbDescribe = RUN_DB ? describe : describe.skip;

dbDescribe("an addendum's deadline is the effective one at runtime", () => {
  const { PrismaClient } = require("@prisma/client");
  const { createHash, randomUUID } = require("node:crypto");
  const { getEffectiveTenderFacts } = require("../lib/engine/effective-tender-facts");

  const prisma = new PrismaClient();
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");

  const ORIGINAL = [
    "REQUEST FOR PROPOSAL",
    "Procuring Entity / Client Name: Northern Roads Authority",
    "Submission Deadline: 10 March 2027 at 14:00 local time.",
    "Submission Method: Email",
    "Submission Email: procurement@nra.example",
    "Required Email Subject: NRA/RFP/2027/001 - Technical Proposal",
  ].join("\n");

  const ADDENDUM = [
    "ADDENDUM NO. 1",
    "Reference: NRA/RFP/2027/001",
    "The submission deadline is hereby extended to 24 March 2027 at 14:00 local time.",
    "All other terms of the original Request for Proposal remain unchanged.",
  ].join("\n");

  let userId = "";
  let tenderId = "";
  let before_: any = null;
  let after_: any = null;

  const addFile = async (name: string, text: string, classification: string, day: number) =>
    prisma.tenderFile.create({
      data: {
        tenderId, fileName: name, originalFileName: name, mimeType: "text/plain",
        size: Buffer.byteLength(text), fileContent: Buffer.from(text).toString("base64"),
        contentByteLength: Buffer.byteLength(text), contentMimeType: "text/plain",
        contentSha256: sha(text), integrityStatus: "VERIFIED", integrityVerifiedAt: new Date(),
        extractedText: text, classification, deletionStatus: "ACTIVE",
        createdAt: new Date(Date.UTC(2027, 0, day)),
      },
    });

  before(async () => {
    const user = await prisma.user.create({
      data: { name: "Amendment Runtime", email: `amend-runtime+${Date.now()}@example.test`, passwordHash: "x", role: "ADMIN" },
    });
    userId = user.id;
    const tender = await prisma.tender.create({
      data: { id: randomUUID(), userId, title: "Northern Roads RFP", status: "ACTIVE" },
    });
    tenderId = tender.id;

    await addFile("01-original-rfp.txt", ORIGINAL, "TENDER", 1);
    before_ = await getEffectiveTenderFacts(prisma, tenderId, userId);

    await addFile("02-addendum-1.txt", ADDENDUM, "addendum", 5);
    after_ = await getEffectiveTenderFacts(prisma, tenderId, userId);
  });

  after(async () => {
    if (tenderId) await prisma.tenderFile.deleteMany({ where: { tenderId } }).catch(() => {});
    if (tenderId) await prisma.tender.delete({ where: { id: tenderId } }).catch(() => {});
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect().catch(() => {});
  });

  it("reports the original deadline before the addendum exists", () => {
    assert.equal(before_.deadlineIso, "2027-03-10T14:00:00.000Z");
  });

  it("reports the amended deadline once the addendum is an active source", () => {
    assert.equal(after_.deadlineIso, "2027-03-24T14:00:00.000Z");
  });

  it("names the document that amended it, not the original notice", () => {
    const fact = (after_.facts ?? []).find((f: any) => f.key === "deadline");
    assert.ok(fact, "the deadline must appear in the effective facts");
    assert.equal(fact.sourceFileName, "02-addendum-1.txt");
    assert.match(String(fact.sourceQuote), /24 March 2027/);
  });

  it("leaves the original notice intact as an active source", async () => {
    const original = await prisma.tenderFile.findFirst({
      where: { tenderId, originalFileName: "01-original-rfp.txt" },
      select: { extractedText: true, deletionStatus: true },
    });
    assert.equal(original?.deletionStatus, "ACTIVE");
    assert.match(String(original?.extractedText), /10 March 2027/);
  });

  it("changes only the fact the addendum states", () => {
    // The addendum extends the deadline and says everything else is unchanged.
    // A partial amendment must not replace the surrounding tender context.
    assert.deepEqual(after_.submissionEmails, ["procurement@nra.example"]);
    assert.equal(after_.submissionMethod, "Email");
    assert.equal(after_.submissionEmailSubject, "NRA/RFP/2027/001 - Technical Proposal");
  });
});
