// The money cases the sector matrix (pricing-cold-start-sector-matrix-db) does
// not cover, on real PostgreSQL: a tender that asks for no price, a
// qualification threshold with no budget, a fixed budget, a foreign-currency
// tender, an arbitrary-country rate card, and a single combined file with a
// tender form. Each money concept stays what it is.

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import mammoth from "mammoth";
import { prisma, prismaReady } from "../lib/prisma";
import { approvePricingEstimate } from "../lib/engine/pricing-approval";
import { loadPricingEstimate } from "../lib/engine/pricing-intelligence-loader";
import { loadPricingScope } from "../lib/engine/pricing-submission-scope";
import { buildFinancialProposalDocx, computeWorkbookTotals } from "../lib/engine/financial-proposal";
import { addRateCardEntries } from "../lib/engine/pricing-rate-card";
import { loadOwnerAttachmentChecklist } from "../lib/engine/owner-attachment-checklist";
import { executeTenderDeletion } from "../lib/tender/delete-tender";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

let userId = "";
const tenderIds: string[] = [];
const TEAM = "Key experts: Team Leader / Water Engineer; Social Specialist";

async function createTender(title: string, country: string, text: string, extra: Record<string, unknown> = {}): Promise<string> {
  const id = (await prisma.tender.create({
    data: {
      userId, title, status: "GENERATED", stage: "TENDER_INTAKE", country,
      files: { create: { fileName: "tor.txt", originalFileName: "tor.txt", mimeType: "text/plain", size: text.length, extractedText: text } },
      requirements: { create: [{ title: "Team", description: TEAM, requirementType: "EXPERT", priority: "MANDATORY" }] },
      ...extra,
    },
  })).id;
  tenderIds.push(id);
  return id;
}

/** Owner rates for every line no source priced, then approval. */
async function approveAll(tenderId: string) {
  const estimate = (await loadPricingEstimate(tenderId, userId, prisma))!;
  const lines = estimate.scenarios.find((s) => s.id === estimate.recommended)!.lines;
  const rates = Object.fromEntries(lines.filter((l) => l.rate === null).map((l) => [l.key, l.unit === "EACH" ? 45_000 : 5_500]));
  const result = await approvePricingEstimate({ tenderId, userId, actorLabel: "owner", request: { scenario: estimate.recommended, rates } }, prisma);
  assert.equal(result.ok, true, JSON.stringify(result));
  return { estimate, workbook: await prisma.pricingWorkbook.findUniqueOrThrow({ where: { tenderId }, include: { lines: true } }) };
}

describe("tender money keeps its meaning — real PostgreSQL", () => {
  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    userId = (await prisma.user.create({ data: { email: `money-matrix-${nonce}@example.test`, name: "Money", passwordHash: "h", company: { create: { name: "Matrix Consulting PLC" } } } })).id;
  });

  after(async () => {
    for (const id of tenderIds) {
      await prisma.auditLog.deleteMany({ where: { entityId: id } });
      await prisma.aiJob.deleteMany({ where: { tenderId: id } });
      await prisma.$transaction((tx) => executeTenderDeletion(tx, id, "money-matrix-test", userId));
    }
    const company = await prisma.company.findUnique({ where: { userId }, select: { id: true } });
    if (company) await prisma.pricingBenchmark.deleteMany({ where: { companyId: company.id } });
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("a tender that asks for no price: no pricing, no approval, no workbook", async () => {
    const tenderId = await createTender("Technical-only design review", "Ethiopia",
      "The consultant shall review the detailed design within three (3) months. Only a technical proposal is required; the evaluation is quality-based. The bidder shall have an annual turnover of ETB 20 million.");
    const scope = (await loadPricingScope(tenderId, userId, prisma))!;
    assert.equal(scope.required, false, scope.basis);
    const result = await approvePricingEstimate({ tenderId, userId, actorLabel: "owner", request: { scenario: "BALANCED" } }, prisma);
    assert.equal((result as any).code, "PRICING_NOT_REQUIRED_BY_TENDER");
    assert.equal(await prisma.pricingWorkbook.count({ where: { tenderId } }), 0);
  });

  it("a qualification threshold with no budget: no ceiling, currency from the instruction", async () => {
    const tenderId = await createTender("Water supply design", "Ethiopia",
      "The assignment shall be completed within four (4) months. The Consultant shall submit a financial proposal; prices shall be quoted in ETB. The bidder shall have completed two similar contracts, each with an estimated contract value of USD 1,000,000, and an average annual turnover of ETB 20 million. A bid security of ETB 50,000 is required.");
    const estimate = (await loadPricingEstimate(tenderId, userId, prisma))!;
    assert.equal(estimate.budget, null, "a threshold is not a budget");
    assert.equal(estimate.currency, "ETB");
    assert.ok(!estimate.warnings.some((w) => w.code === "BUDGET_EXCEEDED"));
  });

  it("a client fixed budget caps the approved offer", async () => {
    const tenderId = await createTender("Feasibility study with a fixed budget", "Ethiopia",
      "The feasibility study shall be completed within five (5) months. The Consultant shall submit a financial proposal. The available budget for this assignment is ETB 2,000,000 inclusive of VAT. Fixed Budget Selection (FBS) applies. Bidders shall have completed similar contracts of at least ETB 5,000,000.");
    const { estimate, workbook } = await approveAll(tenderId);
    assert.equal(estimate.budget?.amount, 2_000_000, "the budget, not the similar-contract threshold");
    assert.ok(computeWorkbookTotals(workbook.lines, workbook).offerTotal <= 2_000_000 + 0.01);
  });

  it("a foreign-currency tender is priced in its own currency, with no Ethiopian rate or VAT", async () => {
    const tenderId = await createTender("Water supply study in Kenya", "Kenya",
      "The assignment shall be completed within four (4) months. The Consultant shall submit a financial proposal. Prices shall be quoted in Kenya Shillings. The bidder's turnover shall exceed ETB 20 million or its equivalent.");
    const { estimate, workbook } = await approveAll(tenderId);
    assert.equal(estimate.currency, "KES", estimate.currencyBasis);
    assert.equal(estimate.vatPercent, 0, "no Ethiopian VAT");
    assert.ok(estimate.benchmarksUsed.every((b) => !b.id.startsWith("seed-et-")), "no Ethiopian benchmark prices a Kenyan tender");
    assert.equal(workbook.currency, "KES");
    const b64 = await buildFinancialProposalDocx({ title: "Financial Proposal", tenderTitle: "Kenya", companyName: "Matrix Consulting PLC", settings: workbook, lines: workbook.lines });
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(b64, "base64") });
    assert.match(value, /KES \d/);
    assert.doesNotMatch(value, /\bETB\b/);
  });

  it("an arbitrary-country rate card: Nigeria's entry prices a Nigerian tender, Ghana's does not", async () => {
    const entry = (market: string, median: number) => ({ category: "PERSONNEL_FEE", serviceKey: "professional", seniority: "EXPERT", unit: "DAY", currency: "NGN", market, median, low: median, high: median, label: `Team leader day rate (${market})`, source: `${market} rate survey 2026`, effectiveDate: "2026-09-01" });
    const added = await addRateCardEntries(userId, [entry("GH", 150_000), entry("NG", 200_000)], prisma);
    assert.equal(added.ok, true, JSON.stringify(added));
    const tenderId = await createTender("Water supply study in Nigeria", "Federal Republic of Nigeria",
      "The assignment shall be completed within four (4) months. The Consultant shall submit a financial proposal. Prices shall be quoted in NGN.");
    const estimate = (await loadPricingEstimate(tenderId, userId, prisma))!;
    assert.equal(estimate.currency, "NGN");
    assert.equal(estimate.market, "NG");
    const leader = estimate.scenarios[1]!.lines.find((l) => /Team Leader/.test(l.label))!;
    assert.equal(leader.rate, 200_000, `${leader.rateBasis}`);
    assert.ok(!estimate.benchmarksUsed.some((b) => /\(GH\)/.test(b.label)), "Ghana's entry is not used");
    assert.ok(estimate.benchmarksUsed.some((b) => /\(NG\)/.test(b.label)), "Nigeria's entry is");
  });

  it("a single combined file with a tender form: the form is placed inside the file, in order", async () => {
    const tenderId = await createTender("Design services, one combined file", "Ethiopia",
      "The Consultant shall submit one PDF file named Proposal.pdf containing the technical proposal, all forms and all annexes.", {
        exactFileNaming: JSON.stringify(["Proposal.pdf"]),
        requirements: { create: [
          { title: "Submission format", description: "One PDF file named Proposal.pdf containing the technical proposal, all forms and all annexes. Attach the company registration certificate.", requirementType: "SUBMISSION_RULE", priority: "MANDATORY" },
          { title: "Bid Submission Form", description: "Complete and sign the Bid Submission Form.", requirementType: "FORM", priority: "MANDATORY", exactFileName: "Bid Submission Form.pdf" },
        ] },
        generatedDocuments: { create: [{ name: "Bid Submission Form", exactFileName: "Bid Submission Form.pdf", documentType: "FORM", format: "CONTROL", generationStatus: "PLANNED", reviewStatus: "REPLACE_WITH_ORIGINAL", validationStatus: "PENDING" }] },
      });
    const list = (await loadOwnerAttachmentChecklist(tenderId, userId, prisma))!;
    assert.equal(list.mode, "COMBINED_FILE");
    const form = list.items.find((i) => i.kind === "Tender-issued form")!;
    assert.ok(form, JSON.stringify(list.items.map((i) => i.kind)));
    assert.match(form.location, /^Inside "Proposal\.pdf"/);
    assert.ok(list.items.every((i) => i.location.startsWith('Inside "Proposal.pdf"')), "every original goes into the one file");
  });
});
