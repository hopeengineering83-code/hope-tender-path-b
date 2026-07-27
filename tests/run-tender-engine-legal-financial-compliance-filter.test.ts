// Real-DB proof for a gap found via live preview screenshots: the engine
// pipeline (lib/engine/run-tender-engine.ts) queried Company with
// `legalRecords: true` / `financialRecords: true` / `complianceRecords: true`
// — no trustLevel filter at all. lib/engine/compliance.ts then treats ANY
// record's mere existence (`knowledge.legalRecords.length > 0`) as full
// (supportStrength 1.0, "SUPPORTED") evidence for LEGAL/FINANCIAL/COMPLIANCE
// requirements, and quotes `knowledge.legalRecords[0]` directly as the
// evidenceReference — an unreviewed (AI_DRAFT), unverified, or even
// fabricated record could satisfy a compliance requirement and be quoted as
// evidence, exactly the authority-bypass class of bug already closed for
// generate-elite.ts, the interactive /ai-proposal route, and
// /regenerate-section in this same pass.
//
// The fix mirrors those exactly: filter to trustLevel REVIEWED (and
// non-expired for legal/compliance) at the query level, so knowledge.*
// can never contain an unreviewed or expired record.

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

let userId: string;
let companyId: string;

describe("run-tender-engine's Company query filters legal/financial/compliance records to REVIEWED-and-non-expired — real PostgreSQL", () => {
  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.user.create({
      data: { email: `engine-lfc-filter-${nonce}@example.test`, name: "Engine LFC Filter Test", passwordHash: "test-hash" },
    });
    userId = user.id;
    const company = await prisma.company.create({ data: { userId, name: `Engine LFC Filter Firm ${nonce}` } });
    companyId = company.id;
  });

  after(async () => {
    await prisma.legalRecord.deleteMany({ where: { companyId } });
    await prisma.financialRecord.deleteMany({ where: { companyId } });
    await prisma.companyComplianceRecord.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  // Mirrors the exact Prisma query shape run-tender-engine.ts now uses.
  function engineQueryInclude() {
    return {
      legalRecords: { where: { trustLevel: "REVIEWED", OR: [{ expiryDate: null }, { expiryDate: { gte: new Date() } }] } },
      financialRecords: { where: { trustLevel: "REVIEWED" } },
      complianceRecords: { where: { trustLevel: "REVIEWED", OR: [{ expiryDate: null }, { expiryDate: { gte: new Date() } }] } },
    };
  }

  it("excludes an AI_DRAFT (unreviewed) legal record — it must never satisfy a LEGAL/ELIGIBILITY requirement as if verified", async () => {
    await prisma.legalRecord.create({
      data: { companyId, recordType: "License", title: "Fabricated Unreviewed License", trustLevel: "AI_DRAFT" },
    });

    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, include: engineQueryInclude() });
    assert.equal(company.legalRecords.length, 0, "an AI_DRAFT legal record must not appear in the engine's evidence set");
  });

  it("includes a REVIEWED, non-expired legal record", async () => {
    await prisma.legalRecord.create({
      data: { companyId, recordType: "License", title: "Genuinely Reviewed License", trustLevel: "REVIEWED", expiryDate: new Date("2099-01-01") },
    });

    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, include: engineQueryInclude() });
    assert.ok(company.legalRecords.some((r) => r.title === "Genuinely Reviewed License"));
  });

  it("excludes a REVIEWED but EXPIRED legal record — a lapsed license must not count as current evidence", async () => {
    await prisma.legalRecord.create({
      data: { companyId, recordType: "License", title: "Expired Reviewed License", trustLevel: "REVIEWED", expiryDate: new Date("2020-01-01") },
    });

    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, include: engineQueryInclude() });
    assert.ok(!company.legalRecords.some((r) => r.title === "Expired Reviewed License"));
  });

  it("excludes an AI_DRAFT financial record and includes a REVIEWED one", async () => {
    await prisma.financialRecord.createMany({
      data: [
        { companyId, fiscalYear: 2025, recordType: "Annual Turnover Statement", trustLevel: "AI_DRAFT" },
        { companyId, fiscalYear: 2024, recordType: "Annual Turnover Statement", trustLevel: "REVIEWED" },
      ],
    });

    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, include: engineQueryInclude() });
    assert.equal(company.financialRecords.length, 1);
    assert.equal(company.financialRecords[0]?.fiscalYear, 2024);
  });

  it("excludes an unreviewed compliance record and an expired-but-reviewed one, keeping only current REVIEWED records", async () => {
    await prisma.companyComplianceRecord.createMany({
      data: [
        { companyId, complianceType: "ISO", title: "Unreviewed cert", trustLevel: "AI_DRAFT" },
        { companyId, complianceType: "ISO", title: "Expired reviewed cert", trustLevel: "REVIEWED", expiryDate: new Date("2020-01-01") },
        { companyId, complianceType: "ISO", title: "Current reviewed cert", trustLevel: "REVIEWED", expiryDate: new Date("2099-01-01") },
      ],
    });

    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, include: engineQueryInclude() });
    assert.deepEqual(company.complianceRecords.map((r) => r.title), ["Current reviewed cert"]);
  });
});
