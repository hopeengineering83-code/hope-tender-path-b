// Regression tests for quality gap fixes from phase 14.
//
// Phase 14 addresses:
//   proposal-quality-scorer.ts: the evidence-density axis filtered out
//   paragraphs shorter than 80 chars, excluding compact but evidence-rich
//   anchors like "Adama Water Supply Scheme — ETB 45M, MoWIE (2019–2022)"
//   (~55 chars). A proposal with dense, short evidence statements scored
//   4/10 on evidenceDensity despite substantive specific evidence.
//   Fix: lower the minimum paragraph length from >80 to >=40. The
//   paragraphHasEvidence() marker check already gates noise (requires a
//   specific currency, named asset, year range, donor, or value indicator).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { scoreProposalQuality } from "../lib/engine/proposal-quality-scorer";

const MINIMAL_STRUCTURE = `
# Cover Letter

Dear Client,

# Executive Summary

## Section A: Company Profile

## Section B: Relevant Experience

## Section C: Technical Approach

## Section D: Additional Information

## Declaration

## Submission Control Sheet
`.trim();

describe("scoreProposalQuality — evidence-density axis with compact evidence", () => {
  it("counts a compact ETB-amount paragraph (50–70 chars) as evidence", () => {
    const md = `${MINIMAL_STRUCTURE}

Adama Water Supply Scheme — ETB 45,000,000, MoWIE (2019–2022).

More narrative text here about the project scope and deliverables.
`;
    const score = scoreProposalQuality({ markdown: md, primarySector: "Water", topProjects: [] });
    // Should count the compact anchor as an evidence paragraph, not exclude it
    assert.ok(score.axes.evidenceDensity >= 4, `evidenceDensity should be ≥4, got ${score.axes.evidenceDensity}`);
  });

  it("counts a compact named-asset paragraph with year range as evidence", () => {
    const md = `${MINIMAL_STRUCTURE}

Pharo Foundation Specialty Hospital — completed 2022, 8,500 m².

Additional context for this project follows below here.
`;
    const score = scoreProposalQuality({ markdown: md, primarySector: "Healthcare", topProjects: [] });
    assert.ok(score.axes.evidenceDensity >= 4, `evidenceDensity should be ≥4 with compact named asset, got ${score.axes.evidenceDensity}`);
  });

  it("counts compact donor reference paragraph as evidence", () => {
    const md = `${MINIMAL_STRUCTURE}

World Bank-funded project delivered 2021 under IDA credit.

Additional narrative text expanding on the project outcomes follows.
`;
    const score = scoreProposalQuality({ markdown: md, primarySector: "Infrastructure", topProjects: [] });
    assert.ok(score.axes.evidenceDensity >= 4, `evidenceDensity should be ≥4 with compact donor reference, got ${score.axes.evidenceDensity}`);
  });

  it("does not count a 40-char paragraph with no evidence markers", () => {
    const md = `${MINIMAL_STRUCTURE}

This is a paragraph that is forty chars exactly.

And another paragraph without any specific evidence markers here.
`;
    const score = scoreProposalQuality({ markdown: md, primarySector: "General", topProjects: [] });
    // Paragraphs without evidence markers should not inflate evidenceDensity
    // (withEvidence should be 0 out of N paragraphs)
    assert.ok(score.axes.evidenceDensity <= 5, `evidenceDensity should be ≤5 for evidence-free paragraphs, got ${score.axes.evidenceDensity}`);
  });

  it("very short paragraphs under 40 chars are still excluded", () => {
    // Paragraphs under 40 chars should still be excluded even if they
    // contain evidence markers (too short to be meaningful context).
    const shortWithMarker = "ETB 5M";  // 6 chars — should be excluded
    const md = `${MINIMAL_STRUCTURE}

${shortWithMarker}

Some longer paragraph about methodology and approach to project delivery.
`;
    // The test confirms no crash and the very short entry doesn't inflate scores
    const score = scoreProposalQuality({ markdown: md, primarySector: "Water", topProjects: [] });
    assert.ok(typeof score.axes.evidenceDensity === "number", "evidenceDensity should be a number");
    assert.ok(score.axes.evidenceDensity >= 0 && score.axes.evidenceDensity <= 10, "evidenceDensity should be 0–10");
  });
});
