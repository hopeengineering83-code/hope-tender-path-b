// Cold-start pricing across eight kinds of consultancy tender, on real
// PostgreSQL: tender → estimate → three scenarios → the recommendation the
// tender's evaluation model calls for → owner approval (entering only what no
// source covers) → pricing workbook → financial proposal DOCX whose figures add
// up, with VAT, in the financial envelope, and nothing technical in it.
//
// The rates the owner types once are filed in the rate card by role and
// seniority, so the next tender of the same kind prices those lines on its own.

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import mammoth from "mammoth";
import { prisma, prismaReady } from "../lib/prisma";
import { approvePricingEstimate } from "../lib/engine/pricing-approval";
import { loadPricingEstimate } from "../lib/engine/pricing-intelligence-loader";
import { buildFinancialProposalDocx, computeWorkbookTotals } from "../lib/engine/financial-proposal";
import { validateDocumentQuality } from "../lib/engine/document-quality-validator";
import { executeTenderDeletion } from "../lib/tender/delete-tender";
import { deleteRateCardEntry, loadRateCard, updateRateCardEntry } from "../lib/engine/pricing-rate-card";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

type Case = { name: string; text: string; team: string; expectModel: string; expectRecommended: string };

// Lines no published source prices. Anything else left unpriced is a defect.
const OWNER_ONLY = new Set(["field-transport", "workshops", "boreholes", "laboratory", "survey", "site-vehicle", "reports"]);

const CASES: Case[] = [
  {
    name: "Architectural design of a G+4 office building",
    text: "The consultant shall prepare the architectural design of a G+4 office building within six (6) months. Five hard copies of the final design report shall be submitted. Evaluation: technical 70%, financial 30%.",
    team: "Key experts: Team Leader / Architect; Structural Engineer; Electrical Engineer; Quantity Surveyor",
    expectModel: "QCBS", expectRecommended: "BALANCED",
  },
  {
    name: "Feasibility study and detailed design of a 42 km gravel road",
    text: "The services comprise feasibility study and detailed design of a 42 km gravel road, completed within eight (8) months, including a topographic survey, 20 test pits and laboratory testing of materials. Site visits along the corridor are required. Technical 80% and financial 20%.",
    team: "Key experts: Team Leader / Highway Engineer; Pavement Engineer; Geotechnical Engineer; Surveyor",
    expectModel: "QCBS", expectRecommended: "BALANCED",
  },
  {
    name: "Rural water supply and sanitation assessment",
    text: "The assignment shall be completed within four (4) months. The consultant will conduct fieldwork in six woredas, with a household survey administered by 10 enumerators, water quality tests, and two validation workshops.",
    team: "Key experts: Team Leader / WASH Specialist; Water Engineer; Social Specialist",
    expectModel: "UNKNOWN", expectRecommended: "BALANCED",
  },
  {
    name: "Geotechnical investigation for a hospital site",
    text: "Geotechnical investigation within three (3) months: 10 boreholes and laboratory soil tests. The contract will be awarded to the lowest evaluated price among responsive bids.",
    team: "Key experts: Geotechnical Engineer; Engineering Geologist",
    expectModel: "LCS", expectRecommended: "AGGRESSIVE",
  },
  {
    name: "Structure plan for a secondary town",
    text: "Preparation of an urban structure plan over twelve (12) months, including GIS base mapping and three public consultations with the community. Quality-Based Selection (QBS) applies.",
    team: "Key experts: Team Leader / Urban Planner; GIS Specialist; Transport Planner; Environmental Specialist",
    expectModel: "QBS", expectRecommended: "CONSERVATIVE",
  },
  {
    name: "Construction supervision of a secondary school",
    text: "Construction supervision of a secondary school over eighteen (18) months, with a full-time resident engineer on site and monthly site supervision visits.",
    team: "Key experts: Resident Engineer; Structural Engineer; Materials Engineer",
    expectModel: "UNKNOWN", expectRecommended: "BALANCED",
  },
  {
    name: "Quantity surveying and contract administration services",
    text: "Quantity surveying and contract administration services for ten (10) months. Technical proposals carry 80% and financial proposals 20%. The Client is not bound to accept the lowest bid.",
    team: "Key experts: Contract Administrator; Senior Quantity Surveyor; Cost Engineer",
    expectModel: "QCBS", expectRecommended: "BALANCED",
  },
  {
    name: "Feasibility study for an agro-processing facility",
    text: "The feasibility study shall be completed within five (5) months. The total budget for this assignment is ETB 3,000,000 inclusive of VAT. Fixed Budget Selection (FBS) applies.",
    team: "Key experts: Team Leader / Economist; Financial Analyst; Market Specialist",
    expectModel: "FIXED_BUDGET", expectRecommended: "BALANCED",
  },
];

let userId = "";
const tenderIds: string[] = [];

describe("cold-start pricing across tender types — real PostgreSQL", () => {
  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    userId = (await prisma.user.create({ data: { email: `pricing-matrix-${nonce}@example.test`, name: "Pricing", passwordHash: "h", company: { create: { name: "Matrix Consulting PLC" } } } })).id;
  });

  after(async () => {
    for (const id of tenderIds) {
      await prisma.auditLog.deleteMany({ where: { entityId: id } });
      await prisma.aiJob.deleteMany({ where: { tenderId: id } });
      await prisma.$transaction((tx) => executeTenderDeletion(tx, id, "pricing-matrix-test", userId));
    }
    const company = await prisma.company.findUnique({ where: { userId }, select: { id: true } });
    if (company) await prisma.pricingBenchmark.deleteMany({ where: { companyId: company.id } });
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function createTender(c: Case): Promise<string> {
    const id = (await prisma.tender.create({
      data: {
        userId, title: c.name, status: "GENERATED", stage: "TENDER_INTAKE", country: "Ethiopia",
        files: { create: { fileName: "tor.txt", originalFileName: "tor.txt", mimeType: "text/plain", size: c.text.length, extractedText: c.text } },
        requirements: { create: [{ title: "Team", description: c.team, requirementType: "EXPERT", priority: "MANDATORY" }] },
      },
    })).id;
    tenderIds.push(id);
    return id;
  }

  for (const c of CASES) {
    it(`${c.name}: estimate → approval → workbook → financial proposal`, async () => {
      const tenderId = await createTender(c);
      const estimate = (await loadPricingEstimate(tenderId, userId, prisma))!;
      assert.ok(estimate, "an estimate is produced");
      assert.equal(estimate.evaluation.model, c.expectModel, estimate.evaluation.basis);
      assert.equal(estimate.recommended, c.expectRecommended);
      assert.equal(estimate.currency, "ETB");
      assert.equal(estimate.vatPercent, 15);

      // Every unpriced line is one no published source covers.
      const recommended = estimate.scenarios.find((s) => s.id === estimate.recommended)!;
      const unpriced = recommended.lines.filter((l) => l.rate === null);
      for (const l of unpriced) assert.ok(OWNER_ONLY.has(l.key), `${l.label} (${l.key}) should have been priced from a source`);
      for (const l of recommended.lines.filter((x) => x.category === "PERSONNEL")) {
        assert.ok(l.rate && l.rate > 0, `${l.label} is priced`);
        assert.ok(l.rateBasis.length > 10 && l.sourceDate, `${l.label} carries its basis and date`);
      }

      // The owner enters only what no source covers, and approves.
      const rates = Object.fromEntries(unpriced.map((l) => [l.key, l.unit === "LUMP_SUM" ? 150_000 : l.unit === "EACH" ? 45_000 : 5_500]));
      const result = await approvePricingEstimate({ tenderId, userId, actorLabel: "owner@example.test", request: { scenario: estimate.recommended, rates, saveToRateCard: true } }, prisma);
      assert.equal(result.ok, true, JSON.stringify(result));

      const workbook = await prisma.pricingWorkbook.findUniqueOrThrow({ where: { tenderId }, include: { lines: true } });
      assert.equal(workbook.scenario, estimate.recommended);
      for (const line of workbook.lines) assert.equal(line.total, Math.round(line.quantity * line.rate * 100) / 100, `${line.label} arithmetic`);
      const totals = computeWorkbookTotals(workbook.lines, workbook);
      assert.equal(totals.offerTotal, (result as { offerTotal: number }).offerTotal);
      assert.equal(totals.vat, Math.round((totals.subtotal + totals.contingency) * 0.15 * 100) / 100);
      if (estimate.budget) assert.ok(totals.offerTotal <= estimate.budget.amount + 0.01, "within the stated budget");

      const b64 = await buildFinancialProposalDocx({ title: "Financial Proposal", tenderTitle: c.name, companyName: "Matrix Consulting PLC", settings: workbook, lines: workbook.lines });
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(b64, "base64") });
      const money = (n: number) => `ETB ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      assert.ok(value.includes(money(totals.offerTotal)), "the offer total is printed");
      assert.ok(value.includes(money(totals.vat)), "the VAT is printed");
      assert.match(value, /inclusive of VAT at 15%/);
      assert.doesNotMatch(value, /\b(?:PERSONNEL|REIMBURSABLE|SUBCONSULTANT|LUMP_SUM)\b/, "no stored codes reach the client");
      assert.doesNotMatch(value, /methodology|work plan|technical approach|key personnel|project experience/i);
      const quality = validateDocumentQuality({ name: "Financial Proposal.docx", documentType: "FINANCIAL_PROPOSAL", fileContent: b64, storagePath: null, visibleText: value });
      assert.equal(quality.envelopeMismatch, null, JSON.stringify(quality));
      assert.deepEqual(quality.placeholders, []);
    });
  }

  it("rates typed once are on the rate card by role and seniority, and price the next tender of the same kind", async () => {
    const card = await loadRateCard(userId, prisma);
    const keys = new Set(card.owner.map((b) => `${b.category}:${b.serviceKey}`));
    assert.ok(keys.has("DRILLING:boreholes") && keys.has("LABORATORY:laboratory") && keys.has("WORKSHOP:workshops"), Array.from(keys).join(", "));
    for (const b of card.owner) {
      assert.equal(b.market, "ET");
      assert.match(b.source, /Rate entered by owner@example\.test when approving the price for/);
    }
    const audit = await prisma.auditLog.findFirst({ where: { userId, action: "PRICING_RATE_CARD_UPDATED" } });
    assert.ok(audit, "filing the rates is audited");

    // One entry per slot: approving two tenders with boreholes keeps one row.
    assert.equal(card.owner.filter((b) => b.category === "DRILLING").length, 1);

    // The first geotechnical tender was least-cost: its boreholes were approved
    // in the Competitive scenario. The next one prices them the same, not a
    // further 5% lower — an approved rate does not ratchet down per tender.
    const first = await prisma.costLine.findFirstOrThrow({ where: { workbook: { tenderId: tenderIds[3] }, label: { startsWith: "Boreholes" } } });
    const again = await createTender({ ...CASES[3]!, name: "Geotechnical investigation for a second site" });
    const estimate = (await loadPricingEstimate(again, userId, prisma))!;
    const recommended = estimate.scenarios.find((s) => s.id === estimate.recommended)!;
    assert.equal(recommended.id, "AGGRESSIVE");
    const boreholes = recommended.lines.find((l) => l.key === "boreholes")!;
    assert.equal(boreholes.rate, first.rate, JSON.stringify(boreholes));
    assert.equal(boreholes.rateSource, "Owner-approved rate on a previous tender");
    assert.match(boreholes.rateBasis, /Competitive scenario, reused at its balanced equivalent/);
    const balanced = estimate.scenarios[1]!.lines.find((l) => l.key === "boreholes")!;
    assert.ok(Math.abs(balanced.rate! - 45_000) / 45_000 < 0.02, `balanced ${balanced.rate} stays at the owner's 45,000 within rounding`);
    assert.ok(recommended.lines.every((l) => l.rate !== null), "nothing left for the owner to type the second time");
  });

  it("an entry is changed or removed only by its own firm, through the validator, and says what it was", async () => {
    const card = await loadRateCard(userId, prisma);
    const entry = card.owner.find((b) => b.category === "WORKSHOP")!;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const otherId = (await prisma.user.create({ data: { email: `pricing-other-${nonce}@example.test`, name: "Other", passwordHash: "h", company: { create: { name: "Other Firm" } } } })).id;
    try {
      assert.equal((await updateRateCardEntry(otherId, entry.id, { median: 1 }, prisma)).ok, false, "another firm cannot change it");
      assert.equal((await deleteRateCardEntry(otherId, entry.id, prisma)).ok, false, "another firm cannot remove it");
    } finally {
      await prisma.user.deleteMany({ where: { id: otherId } });
    }
    const refused = await updateRateCardEntry(userId, entry.id, { source: "" }, prisma);
    assert.equal(refused.ok, false, "an edit cannot drop the source");
    const changed = await updateRateCardEntry(userId, entry.id, { median: 52_000, lastVerified: "2026-10-08" }, prisma);
    assert.equal(changed.ok, true, JSON.stringify(changed));
    if (changed.ok) {
      assert.equal(changed.before.median, entry.median);
      assert.deepEqual([changed.after.low, changed.after.median, changed.after.high], [52_000, 52_000, 52_000]);
    }
    const removed = await deleteRateCardEntry(userId, entry.id, prisma);
    assert.equal(removed.ok, true);
    assert.equal(removed.removed?.label, entry.label, "the removed entry is returned for the audit trail");
    assert.ok(!(await loadRateCard(userId, prisma)).owner.some((b) => b.id === entry.id));
  });
});
