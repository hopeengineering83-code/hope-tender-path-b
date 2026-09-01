/**
 * The vault must not invent people or projects, and must not lose the real ones.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Ingesting a real company authority export (114 projects, 28 experts) through
 * the deterministic extractor produced:
 *
 *   experts:  51  — roughly 23 of them not people at all
 *   projects: 18  — 17 of them table COLUMN HEADINGS
 *
 * and every one was promoted to SOURCE_VERIFIED, so automatic matching could
 * select them and a generated proposal could cite "Million ETB" as a team
 * member or "CLIENT / TYPE ELECTRICAL" as comparable experience. Fabricated
 * entities presented as source-verified evidence is precisely what the
 * provenance rules exist to prevent.
 *
 * The same measurement showed the opposite failure underneath it: of the 114
 * real project names, ZERO were recovered, because extracted PDF text wraps a
 * title across lines and every pattern required the name on one line. So
 * comparable-project evidence was simultaneously contaminated and empty —
 * which caps evidence specificity and comparable-project relevance in any
 * proposal built from that vault, however well the writer performs.
 *
 * These tests pin both directions on realistic wrapped-table text.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { collectDeterministicCandidates } from "../lib/company-knowledge-safety-import";

/** Shaped like real PDF-extracted portfolio text: titles wrap, columns are labels. */
const PROJECT_DOC = {
  id: "doc-projects",
  originalFileName: "Project-References.txt",
  category: "PROJECT",
  extractedText: `PROJECT REFERENCES
CLIENT / TYPE ELECTRICAL
LOCATION/VALUE ACTIVITIES PERFORMED
1 Entoto Eco-Park Master
Planning & Feasibility /
Ethiopian Heritage
Trust
/ Entoto, Addis Ababa,
Ethiopia (1,300 Hectare)
Ref: EHT/GM/057/2025
2 Dessie Specialized
Hospital, Dessie, Amhara
(2,800 m²) / Dessie City
Administration
Ref: DSH/2024/11
3 Haik Town Office
(SB+B+G+2+T) / Haik
town administration
Budget: 12.4M ETB
`,
};

const EXPERT_DOC = {
  id: "doc-experts",
  originalFileName: "Key-Experts.txt",
  category: "EXPERT",
  extractedText: `HOPE URBAN PLANNING
ARCHITECTURAL AND
ENGINEERING CONSULTANCY PLC
CURRICULUM VITAE
ENG. AHMED KEBEDE TEKAW
General Manager
Registered with City Government of
Addis Ababa
Construction Permit & Control Office
License Practicing
Professional Reg. 11406
Structural Engineer
Contract value 27.5 Billion ETB
Structural Engineer
Name of Expert: Asamenew Alye Mohammed
Hope Consultancy PLC
Structural Engineer
`,
};

function namesFrom(docs: Array<typeof PROJECT_DOC>) {
  const c = collectDeterministicCandidates(docs as never);
  return {
    experts: c.experts.map((e) => e.fullName),
    projects: c.projects.map((p) => p.name),
  };
}

describe("column headings are never stored as projects", () => {
  const { projects } = namesFrom([PROJECT_DOC]);

  for (const heading of ["CLIENT / TYPE ELECTRICAL", "LOCATION/VALUE ACTIVITIES PERFORMED"]) {
    it(`rejects the heading ${JSON.stringify(heading)}`, () => {
      assert.ok(
        !projects.some((p) => p.toUpperCase().includes(heading.split("/")[0].trim().toUpperCase()) && /ACTIVITIES|TYPE ELECTRICAL/i.test(p)),
        `"${heading}" must not be filed as a project`,
      );
    });
  }
});

describe("real project titles survive a line wrap", () => {
  const { projects } = namesFrom([PROJECT_DOC]);

  it("recovers a title the PDF wrapped mid-phrase", () => {
    assert.ok(
      projects.some((p) => /Entoto Eco-Park Master Planning/i.test(p)),
      `expected the wrapped Entoto title, got: ${JSON.stringify(projects)}`,
    );
  });

  it("recovers the healthcare comparable", () => {
    assert.ok(projects.some((p) => /Dessie Specialized\s+Hospital/i.test(p)));
  });

  it("stops the title at the entry's own delimiter rather than absorbing the client", () => {
    const entoto = projects.find((p) => /Entoto Eco-Park/i.test(p)) ?? "";
    assert.ok(!/Ethiopian Heritage Trust/i.test(entoto), `title absorbed the client: ${entoto}`);
  });
});

describe("organisations, amounts and labels are never stored as people", () => {
  const { experts } = namesFrom([EXPERT_DOC]);

  for (const notAPerson of [
    ["an organisation", /Hope Consultancy PLC/i],
    ["a currency amount", /Billion ETB/i],
    ["a document label", /Professional Reg/i],
    ["a licence label", /License Practicing/i],
    ["a letterhead fragment", /ARCHITECTURAL AND/i],
    ["a place introduced by \"Government of\"", /^Addis Ababa$/i],
  ] as const) {
    it(`rejects ${notAPerson[0]}`, () => {
      assert.ok(
        !experts.some((e) => notAPerson[1].test(e)),
        `${notAPerson[1]} must not be filed as an expert; got ${JSON.stringify(experts)}`,
      );
    });
  }

  it("still extracts the real people", () => {
    // The guards must not achieve cleanliness by rejecting everyone. Both
    // forms a CV actually uses are covered: an honorific heading
    // ("ENG. AHMED KEBEDE TEKAW") and a labelled field ("Name of Expert:").
    assert.ok(experts.some((e) => /Ahmed Kebede Tekaw/i.test(e)), `lost a real expert: ${JSON.stringify(experts)}`);
    assert.ok(experts.some((e) => /Asamenew Alye Mohammed/i.test(e)), `lost a real expert: ${JSON.stringify(experts)}`);
  });
});
