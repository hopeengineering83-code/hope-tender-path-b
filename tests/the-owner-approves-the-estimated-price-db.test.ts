// The owner's Approve / Adjust Price control, on real PostgreSQL. Approval
// refuses while any line has no defensible rate; once every line is priced it
// writes the workbook with each line's basis, records the approved estimate,
// returns the app-written financial proposal to PLANNED so it is rebuilt from
// these prices, and gives the stopped AUTO_FINALIZE a fresh run.

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";
import { approvePricingEstimate } from "../lib/engine/pricing-approval";
import { loadPricingEstimate } from "../lib/engine/pricing-intelligence-loader";
import { executeTenderDeletion } from "../lib/tender/delete-tender";
import { addRateCardEntries, loadRateCard } from "../lib/engine/pricing-rate-card";
import { resumeAutoFinalizeAfterOwnerInput } from "../lib/ai-jobs/auto-finalize-continuation-job";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

let userId = "";
let tenderId = "";
let financialRowId = "";
let ownerOriginalId = "";
let finalizeJobId = "";

describe("the owner approves the estimated price — real PostgreSQL", () => {
  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    userId = (await prisma.user.create({ data: { email: `pricing-approve-${nonce}@example.test`, name: "Pricing", passwordHash: "h", company: { create: { name: "Firm" } } } })).id;
    tenderId = (await prisma.tender.create({
      data: {
        userId, title: `Feasibility study ${nonce}`, status: "GENERATED", stage: "TENDER_INTAKE", country: "Ethiopia",
        description: "The assignment shall be completed within three (3) months. Two validation workshops will be held.",
        files: { create: { fileName: "tor.txt", originalFileName: "tor.txt", mimeType: "text/plain", size: 10, extractedText: "The assignment shall be completed within three (3) months. Two validation workshops will be held." } },
        requirements: { create: [{ title: "Team", description: "Key experts: Team Leader; Water Engineer", requirementType: "EXPERT", priority: "MANDATORY" }] },
      },
    })).id;
    financialRowId = (await prisma.generatedDocument.create({
      data: {
        tenderId, name: "Financial Proposal", exactFileName: "Financial Proposal.docx", documentType: "FINANCIAL_PROPOSAL", format: "CONTROL",
        generationStatus: "PLANNED", reviewStatus: "REPLACE_WITH_ORIGINAL", validationStatus: "PENDING",
        contentSummary: "Owner pricing required for Financial Proposal.docx: review and approve the estimated price.",
      },
    })).id;
    ownerOriginalId = (await prisma.generatedDocument.create({
      data: {
        tenderId, name: "Commercial Proposal (owner original)", exactFileName: "Commercial Proposal.pdf", documentType: "FINANCIAL_PROPOSAL", format: "PDF",
        generationStatus: "GENERATED", reviewStatus: "READY_FOR_EXPORT", validationStatus: "PASSED", reviewedBy: userId,
        contentSummary: "Original attached by the owner.",
      },
    })).id;
    finalizeJobId = (await prisma.aiJob.create({ data: { userId, tenderId, jobType: "AUTO_FINALIZE", status: "FAILED", input: JSON.stringify({ analysisRevision: "r1" }), retries: 4, errorMessage: "AUTO_FINALIZE_NOT_CONVERGED: owner pricing required" } })).id;
  });

  after(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: tenderId } });
    await prisma.aiJob.deleteMany({ where: { tenderId } });
    await prisma.$transaction((tx) => executeTenderDeletion(tx, tenderId, "pricing-approve-test", userId));
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("cold start: prices the named roles from the cost model and leaves a line no source covers unpriced", async () => {
    const estimate = await loadPricingEstimate(tenderId, userId, prisma);
    assert.ok(estimate);
    assert.equal(estimate!.status, "PARTIAL");
    const lines = estimate!.scenarios[1]!.lines;
    assert.deepEqual(lines.map((l) => l.label).filter((l) => /Leader|Engineer/.test(l)), ["Team Leader", "Water Engineer"]);
    for (const l of lines.filter((x) => x.category === "PERSONNEL")) {
      assert.equal(l.rateSource, "Cost model (public salary scale)");
      assert.equal(l.confidence, "LOW");
      assert.ok(l.build && l.rate! > l.build.costRate, "priced above its day cost");
    }
    const workshops = lines.find((l) => /workshop/i.test(l.label))!;
    assert.equal(workshops.rate, null, "no public source prices a workshop; none is invented");
    assert.ok(estimate!.warnings.some((w) => w.code === "NO_RATE" && /workshop/i.test(w.message)));
    assert.ok(estimate!.benchmarksUsed.some((b) => b.sourceUrl && /addisstandard/.test(b.sourceUrl)));
  });

  it("refuses approval while a line has no rate, and changes nothing", async () => {
    const result = await approvePricingEstimate({ tenderId, userId, actorLabel: "owner@example.test", request: { scenario: "BALANCED" } }, prisma);
    assert.equal(result.ok, false);
    assert.equal((result as any).code, "PRICING_LINES_UNPRICED");
    assert.ok((result as any).unpriced.some((u: { label: string }) => /workshop/i.test(u.label)));
    assert.equal(await prisma.costLine.count({ where: { workbook: { tenderId } } }), 0);
    assert.equal((await prisma.aiJob.findUniqueOrThrow({ where: { id: finalizeJobId } })).status, "FAILED");
  });

  it("approves the owner's rates, records them, rebuilds the app's financial proposal and resumes finalization", async () => {
    const estimate = (await loadPricingEstimate(tenderId, userId, prisma))!;
    const lines = estimate.scenarios[1]!.lines;
    const rates = Object.fromEntries(lines.map((l) => [l.key, l.unit === "EACH" ? 25_000 : 6_000]));
    const result = await approvePricingEstimate({ tenderId, userId, actorLabel: "owner@example.test", request: { scenario: "BALANCED", rates } }, prisma);
    assert.equal(result.ok, true, JSON.stringify(result));

    const workbook = await prisma.pricingWorkbook.findUniqueOrThrow({ where: { tenderId }, include: { lines: true } });
    assert.equal(workbook.scenario, "BALANCED");
    assert.equal(workbook.currency, "ETB");
    assert.equal(workbook.vatPercent, 15);
    assert.equal(workbook.contingencyPct, 5);
    assert.equal(workbook.lines.length, lines.length);
    for (const line of workbook.lines) {
      assert.match(line.notes ?? "", /Approved BALANCED estimate/);
      assert.match(line.notes ?? "", /Adjusted by the owner/);
      assert.equal(line.total, Math.round(line.quantity * line.rate * 100) / 100);
    }
    const audit = await prisma.auditLog.findFirst({ where: { entityId: tenderId, action: "PRICING_ESTIMATE_APPROVED" } });
    assert.ok(audit, "the approval is in the audit trail");
    assert.match(audit!.metadata ?? "", /"scenario":"BALANCED"/);

    const financial = await prisma.generatedDocument.findUniqueOrThrow({ where: { id: financialRowId } });
    assert.equal(financial.generationStatus, "PLANNED");
    assert.equal(financial.reviewStatus, "PENDING", "no longer waiting for the owner's prices");
    const original = await prisma.generatedDocument.findUniqueOrThrow({ where: { id: ownerOriginalId } });
    assert.equal(original.generationStatus, "GENERATED", "an original the owner attached is left alone");

    const job = await prisma.aiJob.findUniqueOrThrow({ where: { id: finalizeJobId } });
    assert.equal(job.status, "QUEUED");
    assert.equal(job.retries, 0, "the owner's input earns a fresh attempt budget");
    assert.match(job.input ?? "", /PRICING_ESTIMATE_APPROVED/);
    assert.match(job.input ?? "", /"analysisRevision":"r1"/, "the stage keeps its revision");
  });

  it("uses the approved rates as evidence for the next tender's estimate", async () => {
    const nonce = `${Date.now()}`;
    const second = await prisma.tender.create({
      data: { userId, title: `Second study ${nonce}`, status: "DRAFT", stage: "TENDER_INTAKE", country: "Ethiopia",
        requirements: { create: [{ title: "Team", description: "Key experts: Team Leader", requirementType: "EXPERT", priority: "MANDATORY" }] } },
    });
    try {
      const estimate = (await loadPricingEstimate(second.id, userId, prisma))!;
      const leader = estimate.scenarios[1]!.lines.find((l) => l.label === "Team Leader")!;
      assert.equal(leader.rate, 6_000);
      assert.equal(leader.rateSource, "Owner-approved rate on a previous tender");
      assert.ok(leader.sourceDate);
    } finally {
      await prisma.$transaction((tx) => executeTenderDeletion(tx, second.id, "pricing-approve-test", userId));
    }
  });

  it("a rate-card entry prices the line on every later estimate; an unsourced entry is refused whole", async () => {
    const refused = await addRateCardEntries(userId, [
      { category: "WORKSHOP", unit: "EACH", currency: "ETB", median: 40_000, label: "Validation workshop", source: "HAEC 2026 venue quotes", effectiveDate: "2026-09-01" },
      { category: "WORKSHOP", unit: "EACH", currency: "ETB", median: 40_000, label: "No source" },
    ], prisma);
    assert.equal(refused.ok, false);
    assert.equal((refused as any).code, "INVALID_ENTRIES");
    assert.equal((await loadRateCard(userId, prisma)).owner.length, 0, "nothing saved from a half-valid import");

    const added = await addRateCardEntries(userId, [
      { category: "WORKSHOP", serviceKey: "workshops", unit: "EACH", currency: "ETB", low: 35_000, median: 40_000, high: 48_000, label: "Validation workshop (one day, 40 people)", source: "HAEC 2026 venue quotes", effectiveDate: "2026-09-01" },
    ], prisma);
    assert.equal(added.ok, true, JSON.stringify(added));
    const estimate = (await loadPricingEstimate(tenderId, userId, prisma))!;
    const [agg, bal, con] = estimate.scenarios;
    for (const [sc, rate] of [[agg, 35_000], [bal, 40_000], [con, 48_000]] as const) {
      const workshops = sc!.lines.find((l) => /workshop/i.test(l.label))!;
      assert.equal(workshops.rate, rate, `${sc!.id} uses the rate card's spread`);
      assert.equal(workshops.rateSource, "Owner rate card");
    }
    assert.ok(estimate.benchmarksUsed.some((b) => b.origin === "OWNER"));
  });

  it("does not re-run an older revision's finalize while a newer Run Engine chain is in flight", async () => {
    await prisma.aiJob.update({ where: { id: finalizeJobId }, data: { status: "SUCCEEDED" } });
    const engine = await prisma.aiJob.create({ data: { userId, tenderId, jobType: "PROPOSAL_GENERATION", status: "RUNNING", input: JSON.stringify({ analysisRevision: "r2" }) } });
    try {
      const resumed = await resumeAutoFinalizeAfterOwnerInput({ tenderId, userId, reason: "PRICING_ESTIMATE_APPROVED" }, prisma);
      assert.equal(resumed.state, "NEWER_RUN_IN_PROGRESS");
      assert.equal((await prisma.aiJob.findUniqueOrThrow({ where: { id: finalizeJobId } })).status, "SUCCEEDED", "the superseded revision's finalize is left alone");
    } finally {
      await prisma.aiJob.delete({ where: { id: engine.id } });
    }
  });
});
