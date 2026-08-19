// P1: every extracted client detail must be traceable to a real source file,
// page and quote before it can count as grounded.
//
// Two defects sat behind this acceptance item at PR #1175 head f2be6001:
//
//  1. buildBackfillCandidates hardcoded `sourceFileId/sourcePage/sourceQuote:
//     null` for all eleven client fields, so they could never be anything but
//     CANDIDATE_NEEDS_REVIEW — even though promotion had already resolved a
//     complete {fileId, page, quote} triple for each of them into
//     `Tender.contactDetailsSourceJson` (attributeMetadataSourceFileId +
//     locateQuoteProvenPage). The evidence was in the database and unread.
//
//  2. Worse, the LIVE sync path — syncPersistedTenderFactsToLedger, which
//     finalizeJob calls after every promotion — did not SELECT the eleven client
//     scalars at all. Prisma returns unselected columns as undefined, and
//     buildBackfillCandidates skips a falsy value, so on the live path those
//     fields produced no ledger row whatsoever. Only tenders touched by the
//     backfill script had them. The backfill select carries an explicit comment
//     warning about exactly this failure mode; the live select did not.
//
// The rule these tests defend is asymmetric, and both halves matter:
//   • complete, defensible evidence → the fact may be grounded
//   • anything partial or absent    → stays CANDIDATE_NEEDS_REVIEW
// Provenance is never invented.
//
// Evidence level B (PostgreSQL, real promotion-shaped data, real ledger sync).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";

/** The eleven client fields named in the acceptance criteria. */
const CLIENT_FIELDS = [
  "legalClientName",
  "donorAgency",
  "implementingAgency",
  "clientAddress",
  "clientContactName",
  "clientContactTitle",
  "clientContactEmail",
  "clientContactPhone",
  "clientWebsite",
  "preBidChannel",
  "clientRepresentative",
] as const;

const CONTACT_QUOTE =
  "The Procuring Entity is the Federal Ministry of Health, represented by Dr. Alem Bekele, Director of Procurement.";

// Page markers matter: computeProvenPageNumber only proves a page from a form
// feed, a "[Page N]" marker, or a line-start "Page N" — otherwise it returns
// null unless the file is a single page. Real extracted text carries these
// markers, and a fixture without them cannot be grounded (correctly so).
const FILE_TEXT =
  "[Page 1]\n" +
  "SECTION 1 — INVITATION TO BID.\n" +
  `${CONTACT_QUOTE}\n` +
  "Correspondence should be addressed to procurement@moh.example.test or +251 11 555 0100.\n" +
  "Further details are published at https://moh.example.test/tenders.\n" +
  "A pre-bid meeting will be held at the Ministry headquarters.\n" +
  "[Page 2]\n" +
  "SECTION 2 — EVALUATION CRITERIA. Bids are scored on technical and financial merit.";

type Seeded = { userId: string; tenderId: string; fileId: string };

/**
 * Seed a tender exactly as promotion leaves it: client scalars populated, and
 * per-field evidence in contactDetailsSourceJson.
 */
async function seedPromotedTender(evidenceFor: (fileId: string) => Record<string, unknown>): Promise<Seeded> {
  const { prisma } = await import("../lib/prisma");
  const bcrypt = (await import("bcryptjs")).default;

  const user = await prisma.user.create({
    data: {
      email: `prov-${randomUUID().slice(0, 8)}@example.test`,
      passwordHash: await bcrypt.hash("Prov-password-2026-secure!", 10),
      role: "ADMIN",
      name: "Provenance Test",
    },
  });
  await prisma.company.create({
    data: { userId: user.id, name: "Prov Co", legalName: "Prov Co Ltd", setupCompletedAt: new Date() },
  });

  const tender = await prisma.tender.create({
    data: {
      userId: user.id,
      title: "Provenance Test Tender",
      clientName: "Federal Ministry of Health",
      legalClientName: "Federal Democratic Republic of Ethiopia — Ministry of Health",
      donorAgency: "World Bank",
      implementingAgency: "Ethiopian Pharmaceuticals Supply Agency",
      clientAddress: "Sudan Street, Addis Ababa, Ethiopia",
      clientContactName: "Dr. Alem Bekele",
      clientContactTitle: "Director of Procurement",
      clientContactEmail: "procurement@moh.example.test",
      clientContactPhone: "+251 11 555 0100",
      clientWebsite: "https://moh.example.test/tenders",
      preBidChannel: "Pre-bid meeting at Ministry headquarters",
      clientRepresentative: "Dr. Alem Bekele",
      files: {
        create: [{
          originalFileName: "itb.pdf",
          fileName: "itb.pdf",
          mimeType: "application/pdf",
          size: 8192,
          extractedText: FILE_TEXT,
          deletionStatus: "ACTIVE",
          contentSha256: "f".repeat(64),
          integrityStatus: "VERIFIED",
          extractionScore: 96,
          extractionMethod: "text",
          totalPages: 8,
        }],
      },
    },
    include: { files: true },
  });
  const fileId = tender.files[0].id;

  await prisma.tender.update({
    where: { id: tender.id },
    data: { contactDetailsSourceJson: JSON.stringify(evidenceFor(fileId)) },
  });

  return { userId: user.id, tenderId: tender.id, fileId };
}

async function cleanup(seeded: Seeded) {
  const { prisma } = await import("../lib/prisma");
  const { userId, tenderId } = seeded;
  await prisma.tenderFactsLedger?.deleteMany({ where: { tenderId } }).catch(() => {});
  await prisma.tenderFile.deleteMany({ where: { tenderId } }).catch(() => {});
  await prisma.tender.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.company.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
}

async function syncAndReadLedger(seeded: Seeded) {
  const { prisma } = await import("../lib/prisma");
  const { syncPersistedTenderFactsToLedger } = await import("../lib/engine/tender-facts-ledger-service");

  await syncPersistedTenderFactsToLedger(prisma, seeded.tenderId, seeded.userId);

  const rows = await prisma.tenderFactsLedger.findMany({ where: { tenderId: seeded.tenderId } });
  return new Map(rows.map((r) => [r.semanticKey, r]));
}

/** Complete, defensible evidence for every client field. */
function fullEvidence(fileId: string): Record<string, unknown> {
  const entry = { fileId, page: 1, quote: CONTACT_QUOTE };
  return Object.fromEntries(CLIENT_FIELDS.map((key) => [key, { ...entry }]));
}

describe("P1: client-detail source provenance", { skip: !RUN_DB }, () => {
  it("gives every one of the eleven client fields a ledger row on the LIVE sync path", async () => {
    const seeded = await seedPromotedTender(fullEvidence);
    try {
      const ledger = await syncAndReadLedger(seeded);

      // Before the fix these columns were not selected on the live path, so all
      // eleven were skipped and produced no row at all.
      for (const key of CLIENT_FIELDS) {
        assert.ok(ledger.has(key), `client field '${key}' must have a ledger row after live sync`);
      }
    } finally {
      await cleanup(seeded);
    }
  });

  it("carries the real source file, page and quote for each field", async () => {
    const seeded = await seedPromotedTender(fullEvidence);
    try {
      const ledger = await syncAndReadLedger(seeded);

      for (const key of CLIENT_FIELDS) {
        const row = ledger.get(key)!;
        assert.equal(row.sourceFileId, seeded.fileId, `${key} must cite the real ACTIVE TenderFile`);
        assert.equal(row.sourcePage, 1, `${key} must carry its proven source page`);
        assert.ok(
          typeof row.sourceQuote === "string" && row.sourceQuote.length >= 10,
          `${key} must carry a meaningful source quote`,
        );
        // The quote must be genuine — actually present in the file text.
        assert.ok(
          FILE_TEXT.includes(row.sourceQuote as string),
          `${key} quote must appear verbatim in the source file text`,
        );
      }
    } finally {
      await cleanup(seeded);
    }
  });

  it("reaches a grounded authority state only with complete evidence", async () => {
    const seeded = await seedPromotedTender(fullEvidence);
    try {
      const ledger = await syncAndReadLedger(seeded);

      for (const key of CLIENT_FIELDS) {
        const row = ledger.get(key)!;
        assert.notEqual(
          row.authorityState,
          "CANDIDATE_NEEDS_REVIEW",
          `${key} has a full source triple, so it must not be pinned to CANDIDATE_NEEDS_REVIEW`,
        );
      }
    } finally {
      await cleanup(seeded);
    }
  });

  it("never upgrades a field whose evidence is incomplete", async () => {
    // Each field is given a DIFFERENT partial defect. None may be grounded.
    const seeded = await seedPromotedTender((fileId) => ({
      legalClientName: { fileId, quote: CONTACT_QUOTE },                 // no page
      donorAgency: { fileId, page: 1 },                                  // no quote
      implementingAgency: { page: 1, quote: CONTACT_QUOTE },             // no file
      clientAddress: { fileId, page: 0, quote: CONTACT_QUOTE },          // invalid page
      clientContactName: { fileId, page: 1, quote: "short" },            // quote too short
      clientContactTitle: { fileId, page: null, quote: CONTACT_QUOTE },  // unproven page
      clientContactEmail: null,                                          // no entry
      clientContactPhone: { fileId: "", page: 1, quote: CONTACT_QUOTE }, // empty file id
      clientWebsite: "not-an-object",                                    // malformed
      preBidChannel: { fileId, page: 1.5, quote: CONTACT_QUOTE },        // non-integer page
      // clientRepresentative deliberately absent from the evidence map entirely
    }));

    try {
      const ledger = await syncAndReadLedger(seeded);

      for (const key of CLIENT_FIELDS) {
        const row = ledger.get(key);
        assert.ok(row, `${key} must still be visible as a candidate, not hidden`);
        assert.equal(row!.sourceFileId, null, `${key} must not claim a source file it cannot defend`);
        assert.equal(row!.sourcePage, null, `${key} must not claim a page it cannot defend`);
        assert.equal(row!.sourceQuote, null, `${key} must not claim a quote it cannot defend`);
        assert.equal(
          row!.authorityState,
          "CANDIDATE_NEEDS_REVIEW",
          `${key} has incomplete evidence and must remain CANDIDATE_NEEDS_REVIEW`,
        );
      }
    } finally {
      await cleanup(seeded);
    }
  });

  it("tolerates malformed contactDetailsSourceJson without inventing provenance", async () => {
    const seeded = await seedPromotedTender(() => ({}));
    const { prisma } = await import("../lib/prisma");
    await prisma.tender.update({
      where: { id: seeded.tenderId },
      data: { contactDetailsSourceJson: "{not valid json" },
    });

    try {
      const ledger = await syncAndReadLedger(seeded);
      for (const key of CLIENT_FIELDS) {
        const row = ledger.get(key);
        assert.ok(row, `${key} must still be recorded as a candidate`);
        assert.equal(row!.sourceFileId, null, `${key} must not fabricate provenance from unparseable JSON`);
        assert.equal(row!.authorityState, "CANDIDATE_NEEDS_REVIEW");
      }
    } finally {
      await cleanup(seeded);
    }
  });
});
