/**
 * Package positions come from the confirmed Build Plan. The technical-proposal
 * writer created its row at position 1 regardless; on a tender that lists the
 * financial proposal first (WHH, 2026-10-07) two documents held position 1 and
 * the export gate refused the package with DUPLICATE_EXACT_ORDER.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { planPositions } from "../lib/engine/align-document-order";

const plan = [
  { exactFileName: "Financial Proposal.docx", exactOrder: 1 },
  { exactFileName: "Technical Proposal.docx", exactOrder: 2 },
];

describe("package positions follow the confirmed plan", () => {
  it("moves a technical proposal written at position 1 behind a financial proposal the plan puts first", () => {
    const positions = planPositions(plan, [
      { id: "tp", exactFileName: "Technical Proposal.docx", name: "Client-Ready Benchmark Technical Proposal", exactOrder: 1 },
      { id: "fp", exactFileName: "Financial Proposal.docx", name: "Financial Proposal", exactOrder: 1 },
    ]);
    assert.equal(positions.get("tp"), 2);
    assert.equal(positions.get("fp"), 1);
    assert.equal(new Set(positions.values()).size, 2, "no two documents share a position");
  });

  it("a DOCX source takes its required PDF's position only while no document holds the PDF name", () => {
    const pdfPlan = [{ exactFileName: "Technical Proposal.pdf", exactOrder: 3 }];
    assert.equal(planPositions(pdfPlan, [{ id: "src", exactFileName: "Technical Proposal.docx", name: null, exactOrder: 1 }]).get("src"), 3);
    const both = planPositions(pdfPlan, [
      { id: "src", exactFileName: "Technical Proposal.docx", name: null, exactOrder: 1 },
      { id: "pdf", exactFileName: "Technical Proposal.pdf", name: null, exactOrder: 1 },
    ]);
    assert.equal(both.get("pdf"), 3);
    assert.equal(both.has("src"), false, "the source is left alone once the PDF holds the position");
  });

  it("leaves a document the plan does not name untouched", () => {
    assert.equal(planPositions(plan, [{ id: "x", exactFileName: "Annex.pdf", name: null, exactOrder: 7 }]).size, 0);
  });

  it("generation and finalization both apply the plan's positions", () => {
    assert.match(readFileSync("lib/engine/generate-elite.ts", "utf8"), /alignDocumentOrderToPlan\(prisma, tenderId, userId\)/);
    const finalize = readFileSync("lib/ai-jobs/auto-finalize-continuation-service.ts", "utf8");
    const align = finalize.indexOf("alignDocumentOrderToPlan(prisma, tenderId, userId)");
    assert.ok(align > 0 && align < finalize.indexOf("await runCanonicalValidation(tenderId, userId)"), "aligned before validation");
  });
});
