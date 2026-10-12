// The evaluator-criteria alignment report is the writer's working material.
//
// 2026-10-08, Pharo tender on the new Preview database: the aligner answered
// for the first time in weeks (it had been failing under provider limits), and
// its report was handed to the writer inside `differentiators` — the field the
// deterministic Value-Added section prints. The client's Technical Proposal
// carried "## SEMANTIC MATCH-TO-CRITERIA ALIGNMENT (…, scored 0–10)" and
// "### Coverage by criterion"; canonical validation refused it
// (RAW_MARKDOWN_HEADING) and the package stopped. The report now travels in its
// own prompt-only field.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { formatAlignmentForPrompt } from "../lib/engine/semantic-match-aligner";
import { buildProposalSectionSpecs, buildSectionFallback, type ProposalSectionSpec } from "../lib/engine/proposal-sections";
import type { AIBidWriterInput } from "../lib/ai";

const REPORT = formatAlignmentForPrompt({
  summary: "The lead architect and two hospital projects carry the healthcare-design criterion.",
  coverageByCriterion: [{ criterionId: "c1", criterion: "Healthcare design experience", weight: 30, coverageScore: 8, topRecords: ["Clinic A"] }],
  alignments: [{ recordType: "project", recordName: "Clinic A", criterion: "Healthcare design experience", criterionWeight: 30, alignmentScore: 8, rationale: "Same facility type.", riskFlag: null }],
} as any);

function writerInput(overrides: Partial<AIBidWriterInput> = {}): AIBidWriterInput {
  return {
    tenderTitle: "Design of a District Clinic", clientName: "County Health Office",
    tenderText: "The consultant shall design a district clinic.", analysisSummary: "", evaluationMethodology: "Healthcare design experience 30%",
    submissionNotes: "", requirements: "SCORED: Healthcare design experience", companyProfile: "", experts: "A. Person — Architect",
    projects: "Clinic A — County Council | Kenya | Healthcare", compliance: "", differentiators: "In-house medical-planning team with infection-control review at each design stage",
    companyVault: { name: "Firm PLC" },
    ...overrides,
  } as AIBidWriterInput;
}

describe("the criteria alignment report never reaches the proposal", () => {
  it("the report is markdown the client must never see", () => {
    assert.match(REPORT, /^## SEMANTIC MATCH-TO-CRITERIA ALIGNMENT/m);
    assert.match(REPORT, /^### Coverage by criterion/m);
  });

  it("the writer's prompts carry it, in its own block", () => {
    const specs = buildProposalSectionSpecs(writerInput({ criteriaAlignment: REPORT }));
    const prompts = specs.map((s) => s.userPrompt).join("\n");
    assert.match(prompts, /CRITERIA ALIGNMENT \(internal analysis/);
    assert.match(prompts, /SEMANTIC MATCH-TO-CRITERIA ALIGNMENT/);
  });

  it("no deterministic section prints it, even if it arrives in differentiators", () => {
    for (const id of ["cover-and-summary", "company-and-experience", "technical-approach", "additional-and-declaration"]) {
      for (const input of [
        writerInput({ criteriaAlignment: REPORT }),
        writerInput({ differentiators: `${REPORT}\n\nIn-house medical-planning team with infection-control review at each design stage` }),
      ]) {
        const md = buildSectionFallback({ id } as unknown as ProposalSectionSpec, input);
        assert.doesNotMatch(md, /SEMANTIC MATCH|Coverage by criterion|scored 0–10/, `${id} printed the alignment report`);
      }
    }
    const d = buildSectionFallback({ id: "additional-and-declaration" } as unknown as ProposalSectionSpec, writerInput({ criteriaAlignment: REPORT }));
    assert.match(d, /In-house medical-planning team/, "the real differentiator is still printed");
  });

  it("generation hands the report over as criteriaAlignment, not differentiators", () => {
    const src = readFileSync("lib/engine/generate-elite.ts", "utf8");
    assert.match(src, /criteriaAlignment: alignmentBlock/);
    assert.doesNotMatch(src, /\.\.\.\(alignmentBlock \? \[alignmentBlock, ""\] : \[\]\)/);
  });
});
