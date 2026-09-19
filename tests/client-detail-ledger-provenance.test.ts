// CLAUDE.md acceptance criterion 4 / requirement 20: every extracted client
// field must carry a source page and source quote.
//
// TenderFactsLedger was already the right home for that — it carries a generic
// (sourceFileId, sourcePage, sourceQuote) triple per semanticKey, and
// upsertTenderFactFromSource derives SOURCE_GROUNDED_CONFIRMED only when the
// full triple is present. But only nine semanticKeys were ever written, so
// eleven client fields the AI extracts and stores on Tender never got a ledger
// row at all. They were invisible to every ledger consumer, and no reviewer
// could tell whether they were traceable to a source.
//
// A field with a value but no traceable source must look exactly like that:
// present, and visibly ungrounded. Absent is the one thing it must not be.
//
// These tests run the real backfill against a real PostgreSQL database.

import { before, after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";
import { backfillTenderFactsForTender } from "../lib/engine/tender-facts-ledger-service";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

// The twelve fields that had no ledger row before this fix.
//
// clientCity was the last one still missing after the first eleven were wired
// up. It is not a cosmetic addition: CLAUDE.md item 9 lists "City / project
// location" among the client details that must be extracted, AI Analyze does
// extract it and asks the provider for its page and quote, and the tender
// detail panel displays it. Only the ledger could not see it, which is the one
// place a reviewer goes to ask whether a displayed value is traceable.
const CLIENT_DETAIL_KEYS = [
  "legalClientName",
  "donorAgency",
  "implementingAgency",
  "clientAddress",
  "clientCity",
  "clientContactName",
  "clientContactTitle",
  "clientContactEmail",
  "clientContactPhone",
  "clientWebsite",
  "preBidChannel",
  "clientRepresentative",
] as const;

let userId: string;
let tenderId: string;

describe("client detail fields reach the facts ledger", () => {
  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.user.create({
      data: { email: `client-detail-${nonce}@example.test`, name: "Client Detail Test", passwordHash: "test-hash" },
    });
    userId = user.id;
    const tender = await prisma.tender.create({
      data: {
        userId,
        title: "Adama Water Supply Design",
        clientName: "Oromia Water Bureau",
        legalClientName: "Oromia Regional State Water and Energy Bureau",
        donorAgency: "African Development Bank",
        implementingAgency: "Oromia Water Works Design Enterprise",
        clientAddress: "Arada Sub-City, Addis Ababa, Ethiopia",
        clientCity: "Adama",
        clientContactName: "Ato Bekele Tadesse",
        clientContactTitle: "Procurement Director",
        clientContactEmail: "procurement@oromiawater.gov.et",
        clientContactPhone: "+251 11 555 0199",
        clientWebsite: "https://oromiawater.gov.et/tenders",
        preBidChannel: "Pre-bid meeting, 10 March, Bureau head office",
        clientRepresentative: "W/ro Hana Girma, Authorized Officer",
      },
      select: { id: true },
    });
    tenderId = tender.id;
  });

  after(async () => {
    await prisma.tenderFactsLedger.deleteMany({ where: { tenderId } });
    await prisma.tender.deleteMany({ where: { id: tenderId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("creates a ledger row for every client detail field", async () => {
    await backfillTenderFactsForTender(prisma as never, { tenderId, apply: true });

    const rows = await prisma.tenderFactsLedger.findMany({
      where: { tenderId },
      select: { semanticKey: true, normalizedValue: true, displayLabel: true },
    });
    const byKey = new Map(rows.map((r) => [r.semanticKey, r]));

    for (const key of CLIENT_DETAIL_KEYS) {
      assert.ok(byKey.has(key), `${key} must have a ledger row — without one it is invisible to every ledger consumer`);
      const row = byKey.get(key)!;
      assert.ok((row.normalizedValue ?? "").length > 0, `${key} must carry its extracted value`);
      assert.ok((row.displayLabel ?? "").length > 0, `${key} must carry a human display label`);
    }
  });

  it("marks them as needing review rather than source-grounded, since they have no page or quote", async () => {
    await backfillTenderFactsForTender(prisma as never, { tenderId, apply: true });

    const rows = await prisma.tenderFactsLedger.findMany({
      where: { tenderId, semanticKey: { in: [...CLIENT_DETAIL_KEYS] } },
      select: { semanticKey: true, authorityState: true, sourcePage: true, sourceQuote: true },
    });

    assert.equal(rows.length, CLIENT_DETAIL_KEYS.length);
    for (const row of rows) {
      assert.equal(row.sourcePage, null, `${row.semanticKey} has no source column on Tender — a page must not be invented`);
      assert.equal(row.sourceQuote, null, `${row.semanticKey} has no source column on Tender — a quote must not be invented`);
      assert.notEqual(
        row.authorityState,
        "SOURCE_GROUNDED_CONFIRMED",
        `${row.semanticKey} must never be reported as source-grounded without a page and quote`,
      );
    }
  });

  it("does not create rows for fields the tender does not have", async () => {
    const bare = await prisma.tender.create({
      data: { userId, title: "Bare Tender", clientName: "Some Bureau" },
      select: { id: true },
    });
    try {
      await backfillTenderFactsForTender(prisma as never, { tenderId: bare.id, apply: true });
      const rows = await prisma.tenderFactsLedger.findMany({
        where: { tenderId: bare.id, semanticKey: { in: [...CLIENT_DETAIL_KEYS] } },
        select: { semanticKey: true },
      });
      assert.deepEqual(rows, [], "an absent field must produce no row at all — never a placeholder row");
    } finally {
      await prisma.tenderFactsLedger.deleteMany({ where: { tenderId: bare.id } });
      await prisma.tender.deleteMany({ where: { id: bare.id } });
    }
  });

  // The tests above prove the ungrounded direction. This one proves the other
  // one, which is the direction that actually satisfies requirement 20: when
  // promotion did resolve a page and a verbatim quote for a client field, the
  // ledger row must carry them and reach SOURCE_GROUNDED_CONFIRMED. Without
  // this, "every client field has a row" could be satisfied by rows that can
  // never be anything but candidates, which is not traceability.
  it("grounds a client field when promotion resolved a complete file, page and quote", async () => {
    const grounded = await prisma.tender.create({
      data: {
        userId,
        title: "Dessie Referral Hospital Upgrade",
        clientName: "Amhara Health Bureau",
        clientCity: "Dessie",
        clientContactName: "Ato Bekele Tadesse",
      },
      select: { id: true },
    });
    const file = await prisma.tenderFile.create({
      data: {
        tenderId: grounded.id,
        fileName: "itb.pdf",
        originalFileName: "itb.pdf",
        mimeType: "application/pdf",
        size: 2048,
      },
      select: { id: true },
    });
    await prisma.tender.update({
      where: { id: grounded.id },
      data: {
        contactDetailsSourceJson: JSON.stringify({
          clientCity: {
            fileId: file.id,
            page: 4,
            quote: "The Bureau's office is located in Dessie, Amhara Region.",
          },
        }),
      },
    });

    try {
      await backfillTenderFactsForTender(prisma as never, { tenderId: grounded.id, apply: true });

      const row = await prisma.tenderFactsLedger.findFirst({
        where: { tenderId: grounded.id, semanticKey: "clientCity" },
        select: { authorityState: true, sourceFileId: true, sourcePage: true, sourceQuote: true, normalizedValue: true },
      });

      assert.ok(row, "clientCity must have a ledger row");
      assert.equal(row.normalizedValue, "Dessie");
      assert.equal(row.sourceFileId, file.id, "the row must point at the file promotion proved the quote in");
      assert.equal(row.sourcePage, 4, "the proven page must be carried, not dropped");
      assert.equal(
        row.sourceQuote,
        "The Bureau's office is located in Dessie, Amhara Region.",
        "the verbatim quote must be carried so a reviewer can check it",
      );
      assert.equal(
        row.authorityState,
        "SOURCE_GROUNDED_CONFIRMED",
        "a complete triple is exactly what grounding means",
      );
    } finally {
      await prisma.tenderFactsLedger.deleteMany({ where: { tenderId: grounded.id } });
      await prisma.tenderFile.deleteMany({ where: { tenderId: grounded.id } });
      await prisma.tender.deleteMany({ where: { id: grounded.id } });
    }
  });

  // The mirror of the test above, and the more important half. Partial evidence
  // is the shape a hallucinated or unlocatable citation takes: a quote with no
  // proven page, a page with no file, a quote too short to check. None of it may
  // be rounded up into a grounded fact.
  it("refuses to ground a client field whose recorded evidence is incomplete", async () => {
    const partial = await prisma.tender.create({
      data: {
        userId,
        title: "Partial Evidence Tender",
        clientName: "Some Bureau",
        clientCity: "Hawassa",
        clientContactName: "Contact Person",
        clientContactTitle: "Officer",
        clientAddress: "Somewhere",
      },
      select: { id: true },
    });
    await prisma.tender.update({
      where: { id: partial.id },
      data: {
        contactDetailsSourceJson: JSON.stringify({
          // quote and file, but no proven page
          clientCity: { fileId: "file-1", page: null, quote: "The office is in Hawassa city." },
          // page and quote, but no file to check them against
          clientContactName: { page: 2, quote: "Contact: the named procurement officer." },
          // a file and a page, but a quote too short to verify anything
          clientContactTitle: { fileId: "file-1", page: 3, quote: "Officer" },
          // a page that is not a valid page number
          clientAddress: { fileId: "file-1", page: 0, quote: "The address of the bureau is stated here." },
        }),
      },
    });

    try {
      await backfillTenderFactsForTender(prisma as never, { tenderId: partial.id, apply: true });

      const rows = await prisma.tenderFactsLedger.findMany({
        where: {
          tenderId: partial.id,
          semanticKey: { in: ["clientCity", "clientContactName", "clientContactTitle", "clientAddress"] },
        },
        select: { semanticKey: true, authorityState: true, sourceFileId: true, sourcePage: true, sourceQuote: true },
      });

      assert.equal(rows.length, 4, "each field still gets a row — visible and visibly ungrounded");
      for (const row of rows) {
        assert.equal(row.sourcePage, null, `${row.semanticKey}: a page must not be kept from incomplete evidence`);
        assert.equal(row.sourceQuote, null, `${row.semanticKey}: a quote must not be kept from incomplete evidence`);
        assert.equal(row.sourceFileId, null, `${row.semanticKey}: a file must not be kept from incomplete evidence`);
        assert.equal(
          row.authorityState,
          "CANDIDATE_NEEDS_REVIEW",
          `${row.semanticKey}: incomplete evidence must never round up to source-grounded`,
        );
      }
    } finally {
      await prisma.tenderFactsLedger.deleteMany({ where: { tenderId: partial.id } });
      await prisma.tender.deleteMany({ where: { id: partial.id } });
    }
  });

  it("is idempotent — re-running does not duplicate or downgrade rows", async () => {
    await backfillTenderFactsForTender(prisma as never, { tenderId, apply: true });
    const first = await prisma.tenderFactsLedger.count({ where: { tenderId } });
    await backfillTenderFactsForTender(prisma as never, { tenderId, apply: true });
    const second = await prisma.tenderFactsLedger.count({ where: { tenderId } });
    assert.equal(second, first, "the ledger is keyed by (tenderId, semanticKey); a re-run must upsert, not duplicate");
  });
});
