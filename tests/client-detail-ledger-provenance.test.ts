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

// The eleven fields that had no ledger row before this fix.
const CLIENT_DETAIL_KEYS = [
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

  it("is idempotent — re-running does not duplicate or downgrade rows", async () => {
    await backfillTenderFactsForTender(prisma as never, { tenderId, apply: true });
    const first = await prisma.tenderFactsLedger.count({ where: { tenderId } });
    await backfillTenderFactsForTender(prisma as never, { tenderId, apply: true });
    const second = await prisma.tenderFactsLedger.count({ where: { tenderId } });
    assert.equal(second, first, "the ledger is keyed by (tenderId, semanticKey); a re-run must upsert, not duplicate");
  });
});
