// 2026-09-27, the four gaps left after accept run 36339908536 (READY, score
// 100), each read from the delivered PDF or the run that produced it:
//
//  1. B.1 Client References printed "<client> representative" as a contact
//     nobody named, and blanked two of three values to "—": the stored figure
//     is the construction cost of the asset, printed unlabelled beside a
//     client the price gate did not recognise.
//  2. Section E sent the evaluator to "A.1 Company Background", "C.6 Work Plan
//     and Schedule" and "Appendix E" — none of them in the document.
//  3. Section E rated 5 requirements PARTIALLY MET that the app's own
//     readiness rated FULLY_MET: their support level was SUBSTANTIAL.
//  4. PROPOSAL_GENERATION chained after ENGINE_RUN in one 300s invocation took
//     a fresh worker's full budget, was killed by the platform, and was failed
//     by stuck-job recovery (accept run 36335401709).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { buildClientReferencesTable } from "../lib/engine/benchmark-tables";
import { pricingLeakageFinding } from "../lib/engine/pricing-hygiene";
import { sealDocumentStructure } from "../lib/engine/document-structure-seal";
import { buildComplianceMatrixSection } from "../lib/engine/compliance-matrix-builder";
import { resolveProposalExecutionBudget, writerBudgetWithin } from "../lib/ai-runtime-capability";
import { statusForRequirement } from "../lib/engine/proposal-quality-repair";

const technical = { name: "Technical Proposal", exactFileName: "Technical Proposal.docx", documentType: "TECHNICAL_PROPOSAL", format: "DOCX" } as never;
const asRead = (row: string) => row.split("|").map((c) => c.trim()).filter(Boolean).join(", ");

describe("the four remaining package gaps", () => {
  it("B.1 states only what the records hold, and its values pass the price gate", () => {
    const md = buildClientReferencesTable([
      { name: "Specialized Hospital", clientName: "City Admin", country: "Kenya", contractValue: 125_000_000, currency: "KES", summary: "Renovation. Construction cost 125,000,000 KES." },
      { name: "District Clinic", clientName: "North Zone, Upper Region", country: "Kenya", contractValue: 2_000_000, currency: "KES", summary: "" },
    ] as never);
    assert.doesNotMatch(md, /representative/i, "no invented reference contact");
    assert.doesNotMatch(md, /named contacts/i, "no claim of contacts the table does not hold");
    const rows = md.split("\n").filter((l) => /^\| (?!Project \||-)/.test(l));
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.match(row, /KES [\d,]+/, "the value is printed, not blanked");
      assert.equal(pricingLeakageFinding(asRead(row), technical), null, row);
    }
    assert.equal(buildClientReferencesTable([]), "", "no references on record, no placeholder table");
  });

  it("a table cell never names a heading the document does not have", () => {
    const md = [
      "# Section A: Company Profile", "## A.1 Company Overview", "x", "## A.2 Service Lines", "x",
      "# Section C: Technical Approach", "## C.5 Work Plan and Deliverables", "x",
      "# Section E: Compliance Matrix", "| # | Where |", "|---|---|",
      "| 1 | Section A.1 Company Background and A.2 Corporate Information |",
      "| 2 | Section C.6 Work Plan and Schedule |",
      "| 3 | Section A.1 Company Overview + Appendix E (Audited Financial Statements) |",
      "Prose naming Section C.9 Something Else stays as written.",
    ].join("\n");
    const out = sealDocumentStructure(md as never).markdown;
    assert.match(out, /\| 1 \| Section A: Company Profile \|/);
    assert.match(out, /\| 2 \| Section C: Technical Approach \|/);
    assert.match(out, /\| 3 \| Section A\.1 Company Overview \+ supporting documents available on request \|/);
    assert.match(out, /Prose naming Section C\.9 Something Else stays as written\./);
    const listed = sealDocumentStructure(md.replace("# Section E", "# Appendix Register\n- Appendix E: Audited Financial Statements\n# Section E") as never).markdown;
    assert.match(listed, /\+ Appendix E \(Audited Financial Statements\) \|/, "a listed appendix is real");
  });

  it("SUBSTANTIAL support is FULLY MET, as the app's readiness rates it", () => {
    const md = buildComplianceMatrixSection({
      requirements: [{ id: "r1", title: "Company Profile", priority: "SCORED" }, { id: "r2", title: "Technical Approach", priority: "SCORED" }],
      matrixRows: [{ requirementId: "r1", supportLevel: "SUBSTANTIAL" }, { requirementId: "r2", supportLevel: "PARTIAL" }] as never,
      gaps: [],
    }) ?? "";
    assert.match(md, /Company Profile[^\n]*\| FULLY MET \|/);
    assert.match(md, /Technical Approach[^\n]*\| PARTIALLY MET \|/);
    assert.doesNotMatch(md, /rows include a mitigation plan/, "no promise of a mitigation the row does not carry");
    assert.doesNotMatch(md, /Bid-Team/);
  });

  it("the writer's budget ends inside the invocation that runs it", () => {
    const budget = resolveProposalExecutionBudget("durable-worker");
    const now = 1_000_000;
    assert.equal(writerBudgetWithin(budget, undefined, now), budget.budgetMs, "no deadline, no change");
    assert.equal(writerBudgetWithin(budget, now + 300_000, now), budget.budgetMs, "a fresh invocation keeps the full budget");
    const late = writerBudgetWithin(budget, now + 150_000, now);
    assert.ok(late + budget.reserveSeconds * 1_000 <= 150_000, `model phase plus reserve fits the time left (got ${late})`);
    const handler = readFileSync("lib/ai-job-handlers-legacy.ts", "utf8");
    assert.match(handler, /generateTenderDocuments\(ctx\.tenderId, ctx\.userId, \{ execution: "durable-worker", deadlineAt: platformDeadlineAt \}\)/);
    assert.match(readFileSync("app/api/ai-jobs/run-next/route.ts", "utf8"), /platformDeadlineAt: startTime \+ maxDuration \* 1000/);
  });

  it("a lost Section E or F is restored from the canonical builders, not the last-resort addenda", () => {
    // Accept run 36345246843 (model path) shipped the addenda's matrix:
    // destinations named after the writer's internal plan, a cover letter
    // "evidenced" by a project card, requirements listed as criteria.
    const source = readFileSync("lib/engine/generate-elite.ts", "utf8");
    const restore = source.indexOf("buildComplianceMatrixSection(complianceMatrixInput);\n    if (restoredMatrix)");
    const mirror = source.indexOf("buildEvaluatorMirrorSection(evaluatorMirrorInput);\n    if (restoredMirror)");
    const addenda = source.indexOf("applyProposalQualityRepairAddenda(workingMarkdown, evaluatorMatrixInput)");
    assert.ok(restore > 0 && mirror > 0 && addenda > 0);
    assert.ok(restore < addenda && mirror < addenda, "canonical E/F are restored before the addenda run");
  });

  it("an attachment rule reads what the requirement is, not a word in its description", () => {
    assert.equal(statusForRequirement("Technical Proposal PDF Submission — Submit one PDF containing the technical proposal and annexes.", "DIRECT"), "FULLY MET");
    assert.equal(statusForRequirement("Annexes / Supporting Documents — copies of CVs and certificates.", "DIRECT"), "PARTIALLY MET");
  });
});
