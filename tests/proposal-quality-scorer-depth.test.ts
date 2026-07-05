// Unit tests for the depth/substance upgrades to proposal-quality-scorer
// (gap #7 — strengthen gameable axes). The scorer's internal helpers
// `sectionDepthMultiplier` and `substantiveTableRowCount` aren't
// exported, so we test their effect through the public
// scoreProposalQuality entry point.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { scoreProposalQuality } from "../lib/engine/proposal-quality-scorer";

const PRIMARY_SECTOR = "Generic"; // sector-neutral so vocab axis doesn't dominate

// Helper — build a proposal markdown with one of three depth profiles
// for each canonical section. Useful for comparing the same skeleton
// at different content densities.
function proposalWithSections(opts: {
  cover: "stub" | "short" | "deep";
  exec: "stub" | "short" | "deep";
  company: "stub" | "short" | "deep";
  experience: "stub" | "short" | "deep";
  technical: "stub" | "short" | "deep";
  additional: "stub" | "short" | "deep";
  declaration: "stub" | "short" | "deep";
}): string {
  const bodies: Record<"stub" | "short" | "deep", string> = {
    stub: "TBD",
    short: "The firm submits this proposal. We bring relevant expertise. The team is qualified.",
    deep: `Our firm has delivered comparable assignments across the past decade. The 2022 Sebeta WASH project (ETB 18M, World Bank) demonstrates EPANET-based hydraulic modelling. Dr. Alemu, our lead engineer, served as Team Leader on that assignment and brings 18 years of relevant licence-grade I water-supply experience. Section A.2 details the firm's corporate metadata, including registration number 12345 and TIN 0001234567.

This second paragraph anchors the technical narrative in delivered evidence. The 2023 Adama Urban Water Supply Scheme (ETB 24M, AfDB-funded) reinforces the firm's capacity to execute the proposed methodology under similar contractual conditions.`,
  };
  return [
    `# Cover Letter\n\n${bodies[opts.cover]}`,
    `# Executive Summary\n\n${bodies[opts.exec]}`,
    `# Section A: Company Profile\n\n${bodies[opts.company]}`,
    `# Section B: Relevant Experience\n\n${bodies[opts.experience]}`,
    `# Section C: Technical Approach\n\n${bodies[opts.technical]}`,
    `# Section D: Additional Information\n\n${bodies[opts.additional]}`,
    `# Declaration\n\n${bodies[opts.declaration]}`,
  ].join("\n\n");
}

describe("structureCompleteness — depth-weighted (gap #7)", () => {
  it("a stub-body proposal scores below a deep-body proposal even though both have all section headings", () => {
    const stub = proposalWithSections({
      cover: "stub", exec: "stub", company: "stub", experience: "stub",
      technical: "stub", additional: "stub", declaration: "stub",
    });
    const deep = proposalWithSections({
      cover: "deep", exec: "deep", company: "deep", experience: "deep",
      technical: "deep", additional: "deep", declaration: "deep",
    });
    const stubScore = scoreProposalQuality({ markdown: stub, primarySector: PRIMARY_SECTOR, topProjects: [] });
    const deepScore = scoreProposalQuality({ markdown: deep, primarySector: PRIMARY_SECTOR, topProjects: [] });
    assert.ok(
      deepScore.axes.structureCompleteness > stubScore.axes.structureCompleteness,
      `expected deep (${deepScore.axes.structureCompleteness}) > stub (${stubScore.axes.structureCompleteness})`,
    );
    // Stub proposals MUST flag structureCompleteness as a weak axis.
    assert.ok(
      stubScore.weakAxes.includes("structureCompleteness"),
      `expected stub proposal to flag structureCompleteness in weakAxes; got ${JSON.stringify(stubScore.weakAxes)}`,
    );
  });

  it("a deep proposal with two stub sections scores meaningfully lower than all-deep", () => {
    // Use stubs (filler bodies = multiplier 0) so the gap clears any
    // round-to-nearest collapse on borderline values.
    const mixed = proposalWithSections({
      cover: "deep", exec: "deep", company: "stub", experience: "deep",
      technical: "deep", additional: "stub", declaration: "deep",
    });
    const allDeep = proposalWithSections({
      cover: "deep", exec: "deep", company: "deep", experience: "deep",
      technical: "deep", additional: "deep", declaration: "deep",
    });
    const mixedScore = scoreProposalQuality({ markdown: mixed, primarySector: PRIMARY_SECTOR, topProjects: [] });
    const deepScore = scoreProposalQuality({ markdown: allDeep, primarySector: PRIMARY_SECTOR, topProjects: [] });
    assert.ok(
      mixedScore.axes.structureCompleteness < deepScore.axes.structureCompleteness,
      `expected mixed (${mixedScore.axes.structureCompleteness}) < deep (${deepScore.axes.structureCompleteness})`,
    );
  });

  it("filler-only bodies (TBD, N/A, Bid-Team Action) count as 0 depth", () => {
    const fillers = [
      "# Cover Letter\n\nTBD",
      "# Executive Summary\n\nN/A",
      "# Section A\n\nBid-Team Action: confirm before submission.",
      "# Section B\n\nTo be confirmed.",
      "# Section C\n\n[INSERT METHODOLOGY]",
      "# Section D\n\nPlaceholder",
      "# Declaration\n\nNone",
    ].join("\n\n");
    const score = scoreProposalQuality({ markdown: fillers, primarySector: PRIMARY_SECTOR, topProjects: [] });
    assert.equal(score.axes.structureCompleteness, 0, `filler-only proposal should score 0 on structureCompleteness, got ${score.axes.structureCompleteness}`);
    assert.ok(score.weakAxes.includes("structureCompleteness"));
  });
});

describe("tableCoverage — substantive rows (gap #7)", () => {
  function proposalWithTable(rows: string[]): string {
    return [
      "# Cover Letter\n\nProposal cover content with substantive body text.",
      "# Executive Summary\n\nExec body with real prose so structure axis is not blocking.",
      "# Section A.1\n\n| Column A | Column B | Column C |",
      "|---|---|---|",
      ...rows,
    ].join("\n");
  }

  it("a table full of TBD/empty cells does NOT count toward tableCoverage", () => {
    const fillerTable = proposalWithTable([
      "| TBD | TBD | TBD |",
      "| N/A | — | placeholder |",
      "| To be confirmed | — | — |",
    ]);
    const realTable = proposalWithTable([
      "| Dr Alemu | 18 yrs | Team Lead |",
      "| Mr Bekele | 12 yrs | Hydraulic Engineer |",
      "| Ms Tigist | 9 yrs | QA Engineer |",
    ]);
    const fillerScore = scoreProposalQuality({ markdown: fillerTable, primarySector: PRIMARY_SECTOR, topProjects: [] });
    const realScore = scoreProposalQuality({ markdown: realTable, primarySector: PRIMARY_SECTOR, topProjects: [] });
    assert.ok(
      realScore.axes.tableCoverage > fillerScore.axes.tableCoverage,
      `expected real (${realScore.axes.tableCoverage}) > filler (${fillerScore.axes.tableCoverage})`,
    );
  });

  it("counts substantive rows, not header / separator rows", () => {
    const minimal = proposalWithTable([
      "| Single cell only |",
    ]);
    // header + separator + 1 data row with only 1 useful cell — substantive count should be 0
    const score = scoreProposalQuality({ markdown: minimal, primarySector: PRIMARY_SECTOR, topProjects: [] });
    assert.ok(score.weakAxes.includes("tableCoverage"));
    // The notes mention that filler rows are being filtered out
    assert.ok(score.notes.some((n) => /tabular evidence/.test(n)), `expected a notes entry about tabular evidence; got ${JSON.stringify(score.notes)}`);
  });
});
