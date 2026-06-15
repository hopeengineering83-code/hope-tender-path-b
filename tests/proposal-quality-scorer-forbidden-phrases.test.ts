// Verifies the expanded FORBIDDEN_PHRASES list (round 4) actually
// reduces aiTraceFreedom when the offending phrases appear. The
// phrases list lives inside the scorer module and is not exported,
// so we exercise it through the public scoreProposalQuality entry
// point.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { scoreProposalQuality } from "../lib/engine/quality/proposal-quality-scorer";

const PRIMARY_SECTOR = "Generic";

function bareProposal(extra: string): string {
  // Minimal valid proposal skeleton so structureCompleteness etc.
  // aren't the dominant signal. Bodies are substantive (≥600 chars
  // would be ideal but the test only checks aiTraceFreedom).
  const body = "We bring deep experience delivering comparable assignments. ".repeat(8);
  return [
    `# Cover Letter\n\n${body}\n\n${extra}`,
    `# Executive Summary\n\n${body}`,
    `# Section A: Company Profile\n\n${body}`,
    `# Section B: Relevant Experience\n\n${body}`,
    `# Section C: Technical Approach\n\n${body}`,
    `# Section D: Additional Information\n\n${body}`,
    `# Declaration\n\n${body}`,
  ].join("\n\n");
}

describe("FORBIDDEN_PHRASES expansion — round 4 additions are caught", () => {
  const phrasesThatShouldFire = [
    "Anthropic recommends the following approach.",
    "Certainly! Below is the proposal.",
    "I have prepared the technical methodology.",
    "Here is the comprehensive bid response.",
    "Please find attached the firm's CV bundle.",
    "We are delighted to submit this proposal.",
    "Our firm brings unparalleled expertise.",
    "The team has a proven track record.",
    "Section to be added before submission.",
    "Going forward, we will streamline operations.",
  ];

  for (const phrase of phrasesThatShouldFire) {
    it(`flags "${phrase.slice(0, 50)}..." as a forbidden phrase`, () => {
      const cleanProposal = bareProposal("");
      const dirtyProposal = bareProposal(phrase);
      const cleanScore = scoreProposalQuality({ markdown: cleanProposal, primarySector: PRIMARY_SECTOR, topProjects: [] });
      const dirtyScore = scoreProposalQuality({ markdown: dirtyProposal, primarySector: PRIMARY_SECTOR, topProjects: [] });
      assert.ok(
        dirtyScore.axes.aiTraceFreedom < cleanScore.axes.aiTraceFreedom,
        `expected aiTraceFreedom to drop after adding "${phrase}" — clean ${cleanScore.axes.aiTraceFreedom} → dirty ${dirtyScore.axes.aiTraceFreedom}`,
      );
    });
  }

  it("doesn't false-positive on a clean proposal", () => {
    const score = scoreProposalQuality({ markdown: bareProposal(""), primarySector: PRIMARY_SECTOR, topProjects: [] });
    assert.equal(score.axes.aiTraceFreedom, 10, `expected pristine bareProposal to score 10/10 on aiTraceFreedom, got ${score.axes.aiTraceFreedom}. Notes: ${JSON.stringify(score.notes)}`);
  });
});
