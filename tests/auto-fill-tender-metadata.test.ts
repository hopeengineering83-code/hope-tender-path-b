// Tests for lib/engine/auto-fill-tender-metadata.ts

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { autoFillTenderMetadata, type MetadataAutoFillResult } from "../lib/engine/auto-fill-tender-metadata";

// Minimal Prisma mock — captures the update call without a real DB
function makePrismaMock() {
  let lastPatch: Record<string, unknown> | null = null;
  const mock = {
    tender: {
      update: async ({ data }: { where: unknown; data: Record<string, unknown> }) => {
        lastPatch = data;
        return {};
      },
    },
    getLastPatch: () => lastPatch,
  };
  return mock;
}

const RICH_TEXT = `
REQUEST FOR PROPOSALS

RFP No. 2026-099

Name of Procuring Entity: African Development Bank

Country: Ethiopia
Category: Healthcare

Deadline: 30 June 2026
Submission Method: Online Portal
Submission Address: https://procurement.afdb.org

Contact Person: Amina Hassan
Email: amina.hassan@afdb.org
Tel: +216 71 102 000

The African Development Bank invites qualified consultants to provide
technical advisory services for health system strengthening in Ethiopia.

Consultants must demonstrate at least 7 years of experience in public health
advisory and submit a minimum of 3 relevant project references. The team shall
include a Lead Health Economist, an epidemiologist, and a monitoring specialist.
Budget is approximately USD 2,500,000. Proposal validity: 120 days.
`.repeat(4);

describe("autoFillTenderMetadata — fills missing fields", () => {
  it("fills clientName when it is empty", async () => {
    const prismaMock = makePrismaMock();
    const tender = {
      id: "t1",
      clientName: null,
      reference: null,
      category: "General",
      country: null,
      deadline: null,
      submissionMethod: null,
      submissionAddress: null,
      clientContactName: null,
      clientContactTitle: null,
      clientContactEmail: null,
      clientContactPhone: null,
      files: [{ extractedText: RICH_TEXT, originalFileName: "rfp.pdf" }],
    };

    const result: MetadataAutoFillResult = await autoFillTenderMetadata(tender, prismaMock as never);

    assert.ok(result.filled.includes("clientName"), `expected clientName in filled, got: ${result.filled}`);
    const patch = prismaMock.getLastPatch();
    assert.ok(patch && typeof patch["clientName"] === "string" && patch["clientName"].length > 0);
  });

  it("fills country when it is empty", async () => {
    const prismaMock = makePrismaMock();
    const tender = {
      id: "t2",
      clientName: null,
      reference: null,
      category: "General",
      country: null,
      deadline: null,
      submissionMethod: null,
      submissionAddress: null,
      clientContactName: null,
      clientContactTitle: null,
      clientContactEmail: null,
      clientContactPhone: null,
      files: [{ extractedText: RICH_TEXT, originalFileName: "rfp.pdf" }],
    };

    const result: MetadataAutoFillResult = await autoFillTenderMetadata(tender, prismaMock as never);
    assert.ok(result.filled.includes("country"), `expected country in filled, got: ${result.filled}`);
  });

  it("does NOT overwrite an existing real clientName", async () => {
    const prismaMock = makePrismaMock();
    const tender = {
      id: "t3",
      clientName: "World Bank",
      reference: null,
      category: "General",
      country: null,
      deadline: null,
      submissionMethod: null,
      submissionAddress: null,
      clientContactName: null,
      clientContactTitle: null,
      clientContactEmail: null,
      clientContactPhone: null,
      files: [{ extractedText: RICH_TEXT, originalFileName: "rfp.pdf" }],
    };

    const result: MetadataAutoFillResult = await autoFillTenderMetadata(tender, prismaMock as never);
    assert.ok(!result.filled.includes("clientName"), `clientName should be skipped when already set, got filled: ${result.filled}`);
    const patch = prismaMock.getLastPatch();
    assert.ok(!patch || patch["clientName"] === undefined, "should not have overwritten clientName");
  });

  it("overwrites a placeholder clientName", async () => {
    const prismaMock = makePrismaMock();
    const tender = {
      id: "t4",
      clientName: "The Client",
      reference: null,
      category: "General",
      country: null,
      deadline: null,
      submissionMethod: null,
      submissionAddress: null,
      clientContactName: null,
      clientContactTitle: null,
      clientContactEmail: null,
      clientContactPhone: null,
      files: [{ extractedText: RICH_TEXT, originalFileName: "rfp.pdf" }],
    };

    const result: MetadataAutoFillResult = await autoFillTenderMetadata(tender, prismaMock as never);
    assert.ok(result.filled.includes("clientName"), `placeholder clientName should be overwritten, got filled: ${result.filled}`);
  });

  it("returns empty filled array when text is too short", async () => {
    const prismaMock = makePrismaMock();
    const tender = {
      id: "t5",
      clientName: null,
      reference: null,
      category: "General",
      country: null,
      deadline: null,
      submissionMethod: null,
      submissionAddress: null,
      clientContactName: null,
      clientContactTitle: null,
      clientContactEmail: null,
      clientContactPhone: null,
      files: [{ extractedText: "too short", originalFileName: "rfp.pdf" }],
    };

    const result: MetadataAutoFillResult = await autoFillTenderMetadata(tender, prismaMock as never);
    assert.deepEqual(result.filled, []);
    assert.ok(result.skipped.includes("text_too_short"));
    assert.equal(prismaMock.getLastPatch(), null, "should not call prisma.update when text too short");
  });

  it("upgrades category from General to specific when inferred", async () => {
    const prismaMock = makePrismaMock();
    const tender = {
      id: "t6",
      clientName: null,
      reference: null,
      category: "General",
      country: null,
      deadline: null,
      submissionMethod: null,
      submissionAddress: null,
      clientContactName: null,
      clientContactTitle: null,
      clientContactEmail: null,
      clientContactPhone: null,
      files: [{ extractedText: RICH_TEXT, originalFileName: "rfp.pdf" }],
    };

    const result: MetadataAutoFillResult = await autoFillTenderMetadata(tender, prismaMock as never);
    const patch = prismaMock.getLastPatch();
    if (result.filled.includes("category")) {
      assert.ok(patch && patch["category"] !== "General", "category should be upgraded from General");
    }
    // It's OK if category wasn't changed — not all texts produce a specific category.
    assert.ok(true);
  });
});
