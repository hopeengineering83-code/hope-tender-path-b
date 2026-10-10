// G7+G9 — tests for the regex-based requirement source extractor.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { extractRequirementSources } from "../lib/engine/requirement-source-extractor";

const FAKE_TENDER = `
[page 1]

Section 1 INTRODUCTION

This Request for Proposal invites firms to submit a technical proposal
for the design of an office fit-out at Eagle Plaza, 7th Floor.

[page 2]

Section 4 EVALUATION CRITERIA

4.1 Relevant Experience

Bidders must demonstrate at least three (3) similar projects delivered
in the last 36 months. Each project reference must include client name,
project value, and contract dates.

[page 3]

4.2 Personnel

The team must include a Lead Architect (PPA licensed) and a Senior
Interior Architect (PAR licensed). Each expert's CV must be attached
in Appendix C.

Section 5 SUBMISSION RULES

The proposal must be submitted by 25 March 2026, 5:00 PM Addis Ababa
time, in two separate sealed envelopes.
`;

describe("extractRequirementSources", () => {
  it("matches a requirement to its source paragraph and returns page + heading", () => {
    const out = extractRequirementSources({
      tenderFileId: "file-1",
      tenderFileText: FAKE_TENDER,
      requirements: [
        { id: "r-experience", title: "Three similar projects in the last 36 months", description: "Bidders must demonstrate at least three similar projects with client name, value, dates." },
      ],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].requirementId, "r-experience");
    assert.ok(out[0].sourceConfidence > 0.25, `expected confidence > 0.25, got ${out[0].sourceConfidence}`);
    assert.equal(out[0].sourceTenderFileId, "file-1");
    assert.equal(out[0].sourcePageNumber, 2);
    assert.ok(out[0].sourceSectionHeading?.toLowerCase().includes("relevant"));
    assert.ok(out[0].sourceExactQuote?.toLowerCase().includes("three") || out[0].sourceExactQuote?.toLowerCase().includes("36 months"), `expected quote to include 'three' or '36 months', got ${out[0].sourceExactQuote}`);
  });

  it("returns confidence=0 when no paragraph matches", () => {
    const out = extractRequirementSources({
      tenderFileId: "file-1",
      tenderFileText: FAKE_TENDER,
      requirements: [
        { id: "r-bogus", title: "Spaceship interior decoration", description: "Apply chrome plating across all warp coils." },
      ],
    });
    assert.equal(out[0].sourceConfidence, 0);
    assert.equal(out[0].sourceExactQuote, undefined);
  });

  it("handles empty file text gracefully", () => {
    const out = extractRequirementSources({
      tenderFileId: "file-1",
      tenderFileText: "",
      requirements: [
        { id: "r-1", title: "any", description: "any" },
      ],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].sourceConfidence, 0);
  });

  it("respects the maxQuoteChars option", () => {
    const longBody = "A ".repeat(500);
    const text = `[page 1]\n\nSection 1 INTRODUCTION\n\n4.1 Long Section\n\n${longBody}\n`;
    const out = extractRequirementSources({
      tenderFileId: "f",
      tenderFileText: text,
      requirements: [{ id: "r", title: "Long Section requirement", description: "A A A A A A" }],
      options: { maxQuoteChars: 60, minConfidence: 0 },
    });
    if (out[0].sourceExactQuote) {
      assert.ok(out[0].sourceExactQuote.length <= 60);
    }
  });
});
