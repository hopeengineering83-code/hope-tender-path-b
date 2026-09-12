// Approving a Vault record that has no source document must not 500.
//
// The Legal/Financial/Compliance approve paths build their optimistic-lock
// `where` clause like this:
//
//     sourceDocument: { is: { id: ownedSource!.id, ... } }
//
// `ownedSource` is null whenever the record has no source document, or one
// belonging to another company. The non-null assertion silences the compiler,
// but at runtime the property access throws and the request returns a 500.
//
// That crash contradicted the policy the code right above it exists to serve:
// a provenance fallback whose entire purpose is to let approval proceed when
// durable provenance cannot be built. The one case it most needed to handle —
// no verifiable source — was the case that could not reach it.
//
// These tests exercise the real query shape against real PostgreSQL: the
// approve update must match a record with no source document, and must still
// refuse to match when the record changed underneath it.

import { before, after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { prisma, prismaReady } from "../lib/prisma";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

let userId: string;
let companyId: string;

describe("approving a source-less Vault record — real PostgreSQL", () => {
  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.user.create({
      data: { email: `approve-null-${nonce}@example.test`, name: "Approve Null Source", passwordHash: "h", role: "ADMIN" },
    });
    userId = user.id;
    const company = await prisma.company.create({ data: { userId, name: `Approve Null Co ${nonce}` } });
    companyId = company.id;
  });

  after(async () => {
    if (companyId) {
      await prisma.legalRecord.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("the approve update matches a record whose sourceDocumentId is null", async () => {
    const record = await prisma.legalRecord.create({
      data: {
        companyId,
        recordType: "TRADE_LICENCE",
        title: "Trade Licence with no uploaded source",
        trustLevel: "AI_DRAFT",
        sourceDocumentId: null,
      },
    });

    // Exactly the shape the route now builds when ownedSource is null.
    const approveWhere = {
      id: record.id,
      companyId,
      updatedAt: record.updatedAt,
      sourceDocumentId: record.sourceDocumentId,
    };

    const result = await prisma.legalRecord.updateMany({
      where: approveWhere,
      data: { trustLevel: "REVIEWED", reviewedBy: userId, reviewedAt: new Date(), updatedAt: new Date() },
    });

    assert.equal(result.count, 1, "approval must reach a record that has no source document");
  });

  it("still refuses to approve against a stale read", async () => {
    // The optimistic lock is the point of the clause — dropping the source
    // assertion must not drop the concurrency guard with it.
    const record = await prisma.legalRecord.create({
      data: { companyId, recordType: "TAX_CERTIFICATE", title: "Concurrent edit", trustLevel: "AI_DRAFT", sourceDocumentId: null },
    });
    const staleUpdatedAt = record.updatedAt;

    // Someone else edits the record first.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await prisma.legalRecord.update({ where: { id: record.id }, data: { title: "Edited by someone else" } });

    const result = await prisma.legalRecord.updateMany({
      where: { id: record.id, companyId, updatedAt: staleUpdatedAt, sourceDocumentId: null },
      data: { trustLevel: "REVIEWED", reviewedBy: userId, reviewedAt: new Date() },
    });

    assert.equal(result.count, 0, "a stale approve must not land — the route turns this into CONCURRENT_UPDATE");
  });
});

describe("no route still dereferences a possibly-null source document", () => {
  for (const kind of ["legal", "financial", "compliance"] as const) {
    it(`${kind}-records builds its approve lock without a non-null assertion`, () => {
      const src = readFileSync(`app/api/company/${kind}-records/[id]/route.ts`, "utf8");
      const codeOnly = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
      assert.doesNotMatch(codeOnly, /ownedSource!/, "a non-null assertion here is a 500 waiting for a source-less record");
      assert.match(codeOnly, /const approveWhere = ownedSource/);
      // The source-document assertion must survive when there IS one.
      assert.match(codeOnly, /sourceDocument: \{\s*is: \{/);
      // And the optimistic lock must survive when there is not.
      assert.match(codeOnly, /: \{ id, companyId: company\.id, updatedAt: record\.updatedAt, sourceDocumentId: record\.sourceDocumentId \}/);
    });
  }
});
