// One reviewed project, cited once in Section C — not once per sub-section.
//
// THE DELIVERED DEFECT
// --------------------
// Run 34048720960 shipped C.3 Technical Methodology reading, in three
// consecutive paragraphs:
//
//   "… Approach demonstrated on G+6 General Hospital – Dr Abdul Seid (Gimba
//    City, South Wollo Zone, Amhara Region)."
//   "… Approach demonstrated on G+6 General Hospital – Dr Abdul Seid (Gimba
//    City, South Wollo Zone, Amhara Region)."
//   "… Approach delivered on G+6 General Hospital – Dr Abdul Seid (Gimba City,
//    South Wollo Zone, Amhara Region)."
//
// Each canonical sub-section falls back to the first project when it has none
// of its own, so a firm with one reviewed record anchors every sub-section on
// it. Template variety made it worse rather than better: the reader sees one
// fact restated three ways and correctly reads it as padding. The fourth
// variant also claimed the firm's three-gate QA framework was "delivered on"
// that project, which the record does not say.
//
// This is local to one Section C block. It is not a rule against citing a
// project more than once in the proposal — the same record still belongs in the
// portfolio, the team-to-project mapping and the compliance matrix.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { amplifySectionCDepth } from "../lib/engine/section-c-depth-amplifier";
import type { ProjectRecord } from "../lib/engine/benchmark-tables";

const ONE_PROJECT = [{
  name: "G+6 General Hospital – Dr Abdul Seid",
  sector: "Healthcare",
  clientName: "Gimba City Administration",
  contractValue: 7_000_000,
  currency: "ETB",
  serviceAreas: JSON.stringify(["Architectural design", "MEP design"]),
  summary: "Hospital design covering clinical zoning and medical gas reticulation.",
}] as unknown as ProjectRecord[];

const EMPTY_SECTION_C = "# Section C: Technical Approach\n\nIntroductory paragraph for the technical approach.\n";

function anchorCount(markdown: string): number {
  return (markdown.match(/G\+6 General Hospital/g) ?? []).length;
}

describe("a single reviewed project is anchored once per Section C block", () => {
  it("does not restate the same project under every sub-section", () => {
    const { markdown } = amplifySectionCDepth(EMPTY_SECTION_C, {
      primarySector: "Healthcare / Medical Facility Design",
      projects: ONE_PROJECT,
      companyName: "Hope Urban Planning Architectural and Engineering Consultancy PLC",
    });
    assert.equal(anchorCount(markdown), 1, `one introduction is enough:\n${markdown}`);
  });

  it("still gives every sub-section a closing sentence", () => {
    const { markdown } = amplifySectionCDepth(EMPTY_SECTION_C, {
      primarySector: "Healthcare / Medical Facility Design",
      projects: ONE_PROJECT,
      companyName: "Hope Urban Planning Architectural and Engineering Consultancy PLC",
    });
    // The sub-sections that cannot anchor fall back to their written
    // alternative rather than to silence — except where the sector paragraph
    // already says the same thing, which the quality sub-section does.
    for (const fallback of [
      /methodology has been developed and refined/,
      /phased work programme draws on established delivery templates/,
    ]) {
      assert.match(markdown, fallback);
    }
    // The quality gates are still stated — once, by the sector paragraph.
    assert.match(markdown, /Quality gates at 30% Schematic, 60% Design Development, and 100% Pre-Issue/);
  });

  it("does not claim the QA framework was delivered on a project record", () => {
    const { markdown } = amplifySectionCDepth(EMPTY_SECTION_C, {
      primarySector: "Healthcare / Medical Facility Design",
      projects: ONE_PROJECT,
      companyName: "Hope Engineering",
    });
    assert.ok(!/Approach delivered on G\+6/.test(markdown), markdown);
  });

  it("uses a different project for each sub-section when the vault has several", () => {
    const three = [
      { ...(ONE_PROJECT[0] as object), name: "Alpha Hospital" },
      { ...(ONE_PROJECT[0] as object), name: "Beta Clinic" },
      { ...(ONE_PROJECT[0] as object), name: "Gamma Medical Centre" },
    ] as unknown as ProjectRecord[];
    const { markdown } = amplifySectionCDepth(EMPTY_SECTION_C, {
      primarySector: "Healthcare / Medical Facility Design",
      projects: three,
      companyName: "Hope Engineering",
    });
    for (const name of ["Alpha Hospital", "Beta Clinic", "Gamma Medical Centre"]) {
      assert.equal((markdown.match(new RegExp(name, "g")) ?? []).length, 1, `${name} once`);
    }
  });
});

// ── A closing sentence must add something ────────────────────────────────────
//
// Run 34049716090 delivered C.3 reading:
//
//   "Quality gates at 30% Schematic, 60% Design Development, and 100%
//    Pre-Issue. Each gate signed off by Project Principal + Technical Director.
//    Independent peer review at 100%. The three-gate quality framework
//    (30% / 60% / 100%) is applied on every engagement. Each gate is signed off
//    by Project Principal and Technical Director before client submission; an
//    independent peer reviewer — not a member of the delivery team — validates
//    the 100% deliverable package."
//
// The written alternative is appended to a sector paragraph that already
// covered the same three facts, so the reader gets them twice in a row.
describe("a closing sentence that restates the paragraph is not appended", () => {
  it("does not state the three quality gates twice", () => {
    const { markdown } = amplifySectionCDepth(EMPTY_SECTION_C, {
      primarySector: "Healthcare / Medical Facility Design",
      projects: ONE_PROJECT,
      companyName: "Hope Engineering",
    });
    const qaBlock = markdown.split(/^##\s+/m).find((block) => /^C\.4 Quality Assurance/.test(block)) ?? markdown;
    const signOffs = (qaBlock.match(/signed off by Project Principal/gi) ?? []).length;
    assert.ok(signOffs <= 1, `the sign-off rule is stated once, got ${signOffs}:\n${qaBlock}`);
  });

  it("still appends a closing sentence that genuinely adds something", () => {
    const { markdown } = amplifySectionCDepth(EMPTY_SECTION_C, {
      primarySector: "Healthcare / Medical Facility Design",
      projects: ONE_PROJECT,
      companyName: "Hope Engineering",
    });
    // The project anchor says something the sector paragraph cannot, so it stays.
    assert.match(markdown, /Approach (?:validated|demonstrated|applied) on G\+6 General Hospital/);
  });
});
