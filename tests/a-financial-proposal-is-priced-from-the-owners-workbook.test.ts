// A tender that asks for a financial proposal gets one priced from the owner's
// pricing workbook — every figure from the workbook, the arithmetic checked —
// or, with no priced line, a row that waits for the owner's prices. It never
// receives the narrative shell it used to: the requirement list, the team and
// the projects, and not one price.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import mammoth from "mammoth";

import { buildFinancialProposalDocx, computeWorkbookTotals, isFinancialProposalFile, pricedLines } from "../lib/engine/financial-proposal";

const settings = { currency: "ETB", validityDays: 120, vatPercent: 15, contingencyPct: 5, withholdingPct: 2 };
const lines = [
  { category: "PERSONNEL", label: "Team Leader", quantity: 20, unit: "DAY", rate: 4_500 },
  { category: "PERSONNEL", label: "Structural Engineer", quantity: 15, unit: "DAY", rate: 3_200 },
  { category: "REIMBURSABLE", label: "Site visits", quantity: 1, unit: "LUMP_SUM", rate: 0, total: 12_000 },
  { category: "OTHER", label: "Unpriced item", quantity: 3, unit: "EACH", rate: 0 },
];

describe("the financial proposal", () => {
  it("adds up: subtotal, contingency, VAT, and an offer price that withholding does not reduce", () => {
    const t = computeWorkbookTotals(lines, settings);
    assert.equal(t.subtotal, 90_000 + 48_000 + 12_000);
    assert.equal(t.contingency, 7_500);
    assert.equal(t.vat, 23_625);
    assert.equal(t.offerTotal, 150_000 + 7_500 + 23_625);
    assert.equal(t.withholding, 3_150);
    assert.equal(t.netAfterWithholding, t.offerTotal - 3_150);
  });

  it("prints only the workbook's priced lines and figures, with no technical-envelope content", async () => {
    const b64 = await buildFinancialProposalDocx({ title: "Financial Proposal", tenderTitle: "Renovation of a Clinic", reference: "RFP X/1", clientName: "Client Authority", companyName: "Northgate PLC", settings, lines });
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(b64, "base64") });
    assert.match(value, /ETB 181,125\.00/);
    assert.match(value, /inclusive of VAT at 15%/);
    assert.match(value, /valid for 120 days/);
    assert.match(value, /Team Leader/);
    assert.doesNotMatch(value, /Unpriced item/);
    assert.doesNotMatch(value, /methodology|work plan|technical approach|key personnel|project experience/i);
    assert.match(value, /not deducted from the offer price/);
  });

  it("is recognised by file name or type, and an unpriced workbook gives no priced lines", () => {
    assert.ok(isFinancialProposalFile("02-Financial-Proposal.docx", ""));
    assert.ok(isFinancialProposalFile("Offer.docx", "FINANCIAL_PROPOSAL"));
    assert.ok(!isFinancialProposalFile("Technical Proposal.docx", "TECHNICAL_PROPOSAL"));
    assert.equal(pricedLines([{ category: "OTHER", label: "x", quantity: 2, unit: "EACH", rate: 0 }]).length, 0);
  });

  it("the plan-file generator prices it from the workbook or waits for the owner, and the pricing page uses the same arithmetic", () => {
    const gen = readFileSync("lib/engine/missing-plan-file-generation.ts", "utf8");
    assert.match(gen, /if \(isFinancialProposalFile\(args\.fileName, args\.documentType\)\)/);
    assert.match(gen, /reviewStatus: "REPLACE_WITH_ORIGINAL",\s*contentSummary: `Owner pricing required/);
    assert.match(readFileSync("app/api/tenders/[id]/pricing/route.ts", "utf8"), /computeWorkbookTotals\(workbook\.lines, workbook\)/);
  });
});

describe("the financial proposal passes the app's own envelope validator", () => {
  it("has no technical-envelope content, placeholders or AI traces", async () => {
    const { validateDocumentQuality } = await import("../lib/engine/document-quality-validator");
    const b64 = await buildFinancialProposalDocx({ title: "Financial Proposal", tenderTitle: "Renovation of a Clinic", reference: "RFP X/1", clientName: "Client Authority", companyName: "Northgate PLC", settings, lines });
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(b64, "base64") });
    const result = validateDocumentQuality({ name: "Financial Proposal.docx", documentType: "FINANCIAL_PROPOSAL", fileContent: b64, storagePath: null, visibleText: value });
    assert.equal(result.envelopeMismatch, null, JSON.stringify(result));
    assert.deepEqual(result.placeholders, []);
    assert.deepEqual(result.aiTrace, []);
    assert.notEqual(result.status, "BLOCKED", JSON.stringify(result));
  });
});

describe("a required financial proposal is planned as a file", () => {
  it("a titled, required financial proposal is a deliverable even 'in a separate envelope'; negatives and forms are not", async () => {
    const { classifySubmissionPlanItem, requiresSubmittedFinancialProposal } = await import("../lib/engine/submission-plan-classifier");
    const required = classifySubmissionPlanItem({ title: "Financial Proposal", description: "The Financial Proposal shall be submitted in a separate envelope, priced in local currency inclusive of VAT.", requirementType: "FINANCIAL_PROPOSAL" } as never);
    assert.equal(required.category, "REQUIRED_OUTPUT_FILE");
    for (const negative of [
      "No financial proposal is required at this stage.",
      "Technical proposal only; the financial proposal will be requested at a later stage.",
      "The financial proposal shall not be included in this submission.",
    ]) {
      assert.equal(requiresSubmittedFinancialProposal("Financial Proposal", negative), false, negative);
      assert.notEqual(classifySubmissionPlanItem({ title: "Financial Proposal", description: negative, requirementType: "FINANCIAL_PROPOSAL" } as never).category, "REQUIRED_OUTPUT_FILE", negative);
    }
    assert.equal(requiresSubmittedFinancialProposal("Financial Proposal", "Submit the priced Financial Proposal using the prescribed form."), false);
    assert.equal(requiresSubmittedFinancialProposal("Envelope Separation", "Technical and financial proposals shall be submitted in separate envelopes."), false);
  });
});
