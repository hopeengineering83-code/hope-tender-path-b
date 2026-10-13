// Findings 2 and 6, on real PostgreSQL. An owner's edit to a quantity or rate
// is either used exactly — on screen, in the approved workbook and in the
// financial proposal the client reads — or refused with the reason. A zero or
// negative quantity used to fall back silently to the estimate's quantity, and
// the panel showed the estimate's amount beside the edited rate.

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import JSZip from "jszip";
import { prisma, prismaReady } from "../lib/prisma";
import { approvePricingEstimate } from "../lib/engine/pricing-approval";
import { loadPricingEstimate } from "../lib/engine/pricing-intelligence-loader";
import { executeTenderDeletion } from "../lib/tender/delete-tender";
import { buildFinancialProposalDocx } from "../lib/engine/financial-proposal";
import { editedLine } from "../lib/engine/priced-line-amount";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

let userId = "";
let tenderId = "";

const docxText = async (base64: string) => {
  const zip = await JSZip.loadAsync(Buffer.from(base64, "base64"));
  return (await zip.file("word/document.xml")!.async("string")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
};

describe("an edited price is the approved price — real PostgreSQL", () => {
  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    userId = (await prisma.user.create({ data: { email: `edited-price-${nonce}@example.test`, name: "Pricing", passwordHash: "h", company: { create: { name: "Firm" } } } })).id;
    tenderId = (await prisma.tender.create({
      data: {
        userId, title: `Feasibility study ${nonce}`, status: "GENERATED", stage: "TENDER_INTAKE", country: "Ethiopia",
        files: { create: { fileName: "tor.txt", originalFileName: "tor.txt", mimeType: "text/plain", size: 10, extractedText: "The assignment shall be completed within three (3) months. Two validation workshops will be held. The Consultant shall submit a financial proposal." } },
        requirements: { create: [{ title: "Team", description: "Key experts: Team Leader; Water Engineer", requirementType: "EXPERT", priority: "MANDATORY" }] },
      },
    })).id;
  });

  after(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: tenderId } });
    await prisma.aiJob.deleteMany({ where: { tenderId } });
    await prisma.$transaction((tx) => executeTenderDeletion(tx, tenderId, "edited-price-test", userId));
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const pricedRequest = async () => {
    const lines = (await loadPricingEstimate(tenderId, userId, prisma))!.scenarios[1]!.lines;
    return { lines, rates: Object.fromEntries(lines.map((l) => [l.key, l.unit === "EACH" ? 25_000 : 6_000])) as Record<string, number> };
  };

  it("zero, negative and unreadable quantities are refused with the line named, and nothing is written", async () => {
    const { lines, rates } = await pricedRequest();
    const leader = lines.find((l) => l.label === "Team Leader")!;
    for (const bad of [0, -5, Number.NaN]) {
      const result = await approvePricingEstimate({ tenderId, userId, actorLabel: "owner", request: { scenario: "BALANCED", rates, quantities: { [leader.key]: bad } } }, prisma);
      assert.equal(result.ok, false, String(bad));
      assert.equal((result as any).code, "PRICING_INVALID_EDIT", String(bad));
      assert.match((result as any).error, /Team Leader — quantity/);
      assert.match((result as any).error, /untick it/);
      assert.equal(await prisma.costLine.count({ where: { workbook: { tenderId } } }), 0, "nothing approved");
    }
    const negativeRate = await approvePricingEstimate({ tenderId, userId, actorLabel: "owner", request: { scenario: "BALANCED", rates: { ...rates, [leader.key]: -10 } } }, prisma);
    assert.equal((negativeRate as any).code, "PRICING_INVALID_EDIT");
  });

  it("an explicit exclusion leaves the line out, transparently", async () => {
    const { lines, rates } = await pricedRequest();
    const workshops = lines.find((l) => /workshop/i.test(l.label))!;
    const result = await approvePricingEstimate({ tenderId, userId, actorLabel: "owner", request: { scenario: "BALANCED", rates, exclude: [workshops.key] } }, prisma);
    assert.equal(result.ok, true, JSON.stringify(result));
    const workbook = await prisma.pricingWorkbook.findUniqueOrThrow({ where: { tenderId }, include: { lines: true } });
    assert.ok(!workbook.lines.some((l) => /workshop/i.test(l.label)));
    assert.equal(workbook.lines.length, lines.length - 1);
  });

  it("an edited rate and quantity: the panel's amount = the workbook's = the financial proposal's", async () => {
    const { lines, rates } = await pricedRequest();
    const leader = lines.find((l) => l.label === "Team Leader")!;
    const typed = { rate: "7,125.50", quantity: "33" };
    const onScreen = editedLine(leader, typed.rate, typed.quantity);
    assert.equal(onScreen.invalid, false);
    const result = await approvePricingEstimate({ tenderId, userId, actorLabel: "owner", request: { scenario: "BALANCED", rates: { ...rates, [leader.key]: 7_125.5 }, quantities: { [leader.key]: 33 } } }, prisma);
    assert.equal(result.ok, true, JSON.stringify(result));
    const workbook = await prisma.pricingWorkbook.findUniqueOrThrow({ where: { tenderId }, include: { lines: true } });
    const stored = workbook.lines.find((l) => l.label === "Team Leader")!;
    assert.equal(stored.quantity, 33);
    assert.equal(stored.rate, 7_125.5);
    assert.equal(stored.total, onScreen.amount, "the workbook holds the amount shown");
    const proposal = await docxText(await buildFinancialProposalDocx({
      title: "Financial Proposal", tenderTitle: "T", companyName: "Firm",
      settings: { currency: workbook.currency, validityDays: 90, vatPercent: workbook.vatPercent, contingencyPct: workbook.contingencyPct, withholdingPct: 0 },
      lines: workbook.lines.map((l) => ({ category: l.category, label: l.label, quantity: l.quantity, unit: l.unit, rate: l.rate, total: l.total })),
    }));
    const amount = `${workbook.currency} ${onScreen.amount!.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    assert.ok(proposal.includes(amount), `the financial proposal prints ${amount}`);
    assert.ok(!proposal.includes(`${workbook.currency} ${leader.amount!.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`), "never the estimate's original amount");
  });
});
