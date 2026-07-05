// Regression tests for quality gap fixes from phase 9.
//
// Phase 9 addresses:
//   proposal-labels.ts: formatRequirementLine did not accept or surface
//   sourceSectionHeading from TenderRequirement. The AI prompt receives
//   requirement lines that include [p.N] page citations but not section
//   context — so the AI cannot write "as specified in Section 4.3" even
//   when that information is in the DB.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { formatRequirementLine } from "../lib/engine/proposal-labels";

describe("formatRequirementLine — sourceSectionHeading", () => {
  it("appends (§ Section Name) when sourceSectionHeading is provided", () => {
    const out = formatRequirementLine({
      title: "Technical Proposal",
      description: "Submit sealed technical proposal",
      sourcePageNumber: 12,
      sourceSectionHeading: "4.3 Submission Requirements",
    });
    assert.ok(out.includes("(§ 4.3 Submission Requirements)"), `expected section tag in: ${out}`);
  });

  it("section tag appears after page citation", () => {
    const out = formatRequirementLine({
      title: "Company Registration",
      description: "Valid certificate required",
      sourcePageNumber: 5,
      sourceSectionHeading: "Eligibility Criteria",
    });
    const pageIdx = out.indexOf("[p.5]");
    const sectionIdx = out.indexOf("(§ Eligibility Criteria)");
    assert.ok(pageIdx !== -1, "page citation must be present");
    assert.ok(sectionIdx !== -1, "section tag must be present");
    assert.ok(pageIdx < sectionIdx, "page citation must appear before section tag");
  });

  it("does NOT append section tag when sourceSectionHeading is null", () => {
    const out = formatRequirementLine({
      title: "Bid Bond",
      description: "2% of contract value",
      sourcePageNumber: 7,
      sourceSectionHeading: null,
    });
    assert.ok(!out.includes("(§"), "null sourceSectionHeading must not produce a section tag");
  });

  it("does NOT append section tag when sourceSectionHeading is undefined", () => {
    const out = formatRequirementLine({
      title: "Experience",
      description: "5 years minimum",
    });
    assert.ok(!out.includes("(§"), "missing sourceSectionHeading must not produce a section tag");
  });

  it("truncates very long section headings at 80 chars", () => {
    const longHeading = "A".repeat(100);
    const out = formatRequirementLine({
      title: "Something",
      description: "Something else",
      sourceSectionHeading: longHeading,
    });
    const match = out.match(/\(§ ([^)]+)\)/);
    assert.ok(match, "section tag must be present");
    assert.ok(match![1].length <= 80, `section heading must be truncated to 80 chars, got ${match![1].length}`);
  });

  it("still works with no sourcePageNumber and a section heading", () => {
    const out = formatRequirementLine({
      title: "Key Personnel CVs",
      description: "Curriculum vitae for all key experts",
      sourceSectionHeading: "Personnel Requirements",
    });
    assert.ok(!out.includes("[p."), "no page citation when sourcePageNumber absent");
    assert.ok(out.includes("(§ Personnel Requirements)"), "section tag must still appear");
  });
});
