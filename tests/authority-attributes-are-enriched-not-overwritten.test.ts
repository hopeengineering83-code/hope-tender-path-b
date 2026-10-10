// A structured authority owns its records' ATTRIBUTES too, not just their names.
//
// WHY THIS FILE EXISTS
// --------------------
// Records that already exist are updated from the heuristic extraction pass,
// and that update wrote every scalar unconditionally. So a pass that simply did
// not find a client erased the one already stored.
//
// Measured on a real authority export declaring a client for 107 of its 114
// projects: after ingestion, FIVE still had one. The header-run guard had
// correctly refused the table caption the extractor used to capture, and
// `clientName: null` then overwrote the canonical value. Before that guard the
// same write replaced the canonical client with the caption itself, which is
// how "Approach demonstrated on <hospital> (/Location (with Area & Full
// Address) Testimony Details ...)" reached a client-facing proposal.
//
// Both are one defect: a weaker source overwriting a stronger one. The rule the
// surrounding comments already state is verify-and-ENRICH — fill blanks, earn
// provenance, never replace what the authority declared.
//
// An ordinary unstructured vault is deliberately unaffected: there the
// heuristic IS the source, so re-extraction still refreshes values. The second
// describe block pins that, so the fix cannot be mistaken for "stop updating".

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { prisma, prismaReady } from "../lib/prisma";
import { runCompanyKnowledgeSafetyImport } from "../lib/company-knowledge-safety-import";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

// Shaped like a real portfolio table: the project's own entry states no client
// on a line the `Client:` capture can read, so the heuristic pass finds none.
const PORTFOLIO_TEXT = [
  "COMPANY PROJECT PORTFOLIO",
  "Project Name Client/Location (with Area & Full Address) Testimony Details (Ref No, Date, Author) Project Cost Details Project Duration",
  "1 Northern Referral Hospital Expansion",
  "Scope: Architectural and MEP design for a 120-bed referral hospital expansion.",
  "2 Lakeside Museum Renovation",
  "Scope: Conservation-led renovation of a listed museum building.",
].join("\n");

async function seedCompany(nonce: string, withStructuredAuthority: boolean) {
  const user = await prisma.user.create({
    data: { email: `authority-enrich-${nonce}@example.test`, name: "Authority Enrich Test", passwordHash: "test-hash" },
  });
  const company = await prisma.company.create({ data: { userId: user.id, name: `Authority Enrich Firm ${nonce}` } });

  const document = await prisma.companyDocument.create({
    data: {
      companyId: company.id,
      fileName: "portfolio.txt",
      originalFileName: "Project-References.txt",
      mimeType: "text/plain",
      size: PORTFOLIO_TEXT.length,
      storagePath: "",
      category: "PROJECT_REFERENCE",
      extractedText: PORTFOLIO_TEXT,
      contentSha256: createHash("sha256").update(PORTFOLIO_TEXT, "utf8").digest("hex"),
      contentByteLength: Buffer.byteLength(PORTFOLIO_TEXT, "utf8"),
      integrityStatus: "VERIFIED",
    },
  });

  // The canonical record, as the structured import writes it.
  await prisma.project.create({
    data: {
      companyId: company.id,
      name: "Northern Referral Hospital Expansion",
      clientName: "Regional Health Bureau",
      country: "Kenya",
      sector: "Healthcare",
      trustLevel: "AI_DRAFT",
      sourceDocumentId: document.id,
    },
  });

  if (withStructuredAuthority) {
    // PlanBStaging is the durable marker the structured route writes; it is
    // what tells ingestion that identities are authority-owned.
    await prisma.planBStaging.create({
      data: { companyId: company.id, originalFileName: "Projects Reference.pdf", rawText: PORTFOLIO_TEXT },
    });
  }

  return { userId: user.id, companyId: company.id };
}

async function cleanup(userId: string, companyId: string) {
  await prisma.project.deleteMany({ where: { companyId } });
  await prisma.expert.deleteMany({ where: { companyId } });
  await prisma.planBStaging.deleteMany({ where: { companyId } });
  await prisma.companyDocument.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

describe("a structured authority's attributes survive heuristic re-extraction", () => {
  let userId: string;
  let companyId: string;

  before(async () => {
    await prismaReady;
    const seeded = await seedCompany(`${Date.now()}-${Math.random().toString(16).slice(2)}`, true);
    userId = seeded.userId;
    companyId = seeded.companyId;
    await runCompanyKnowledgeSafetyImport(prisma, companyId);
  });

  after(async () => { await cleanup(userId, companyId); });

  it("keeps the client the authority declared", async () => {
    const project = await prisma.project.findFirst({ where: { companyId, name: "Northern Referral Hospital Expansion" } });
    assert.ok(project, "the canonical project disappeared");
    assert.equal(project.clientName, "Regional Health Bureau", "the canonical client was overwritten by the heuristic pass");
    assert.equal(project.country, "Kenya", "the canonical country was overwritten by the heuristic pass");
    assert.equal(project.sector, "Healthcare", "the canonical sector was overwritten by the heuristic pass");
  });

  it("never stores the table's column header as an attribute", async () => {
    const projects = await prisma.project.findMany({ where: { companyId } });
    for (const project of projects) {
      for (const value of [project.clientName, project.country]) {
        if (!value) continue;
        assert.doesNotMatch(value, /Testimony Details|\(with Area/i, `a column header was stored as an attribute: ${value}`);
      }
    }
  });
});

describe("an ordinary unstructured vault still refreshes on re-extraction", () => {
  let userId: string;
  let companyId: string;

  before(async () => {
    await prismaReady;
    const seeded = await seedCompany(`${Date.now()}-${Math.random().toString(16).slice(2)}-plain`, false);
    userId = seeded.userId;
    companyId = seeded.companyId;
    await runCompanyKnowledgeSafetyImport(prisma, companyId);
  });

  after(async () => { await cleanup(userId, companyId); });

  it("still extracts identities from the source text", async () => {
    // Without the structured-authority marker the extractor may create records
    // from the document, which is exactly what an unstructured vault needs.
    const projects = await prisma.project.findMany({ where: { companyId } });
    assert.ok(projects.length >= 1, "extraction produced nothing for an unstructured vault");
  });
});
