// A project summary copied from a numbered list keeps the list's item number.
// A hosted A.3 printed "14 G+6 General Hospital – …" as each expert's key
// technical contribution. Fixtures are generic.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { buildTeamToProjectMappingTable } from "../lib/engine/benchmark-tables";

const expert = { fullName: "Alex Person", title: "Architect", profile: "Projects: District Clinic Block B (design lead)." } as never;
const project = (summary: string) => ({ name: "District Clinic Block B", sector: "Healthcare", summary }) as never;

describe("a source list number is not part of the contribution", () => {
  it("drops the number that precedes the project's own name", () => {
    const md = buildTeamToProjectMappingTable([expert], [project("14 District Clinic Block B / County Office (3,000 m²)")]);
    assert.match(md, /\| District Clinic Block B \/ County Office \(3,000 m²\) \|$/m);
  });

  it("keeps a number that is part of the summary", () => {
    const md = buildTeamToProjectMappingTable([expert], [project("12 storey outpatient block with 40 consulting rooms.")]);
    assert.match(md, /12 storey outpatient block/);
  });
});

// 2026-10-05: a summary that ran into the reference letter's figures printed
// "Construction Cost: 253,000,000.00. Geotechnical & New Design Cost: 800,000.…"
// — the firm's own fee, in a technical envelope.
describe("a contribution carries no cost, fee or amount", () => {
  it("drops the money sentences and the testimony bookkeeping", () => {
    const md = buildTeamToProjectMappingTable([expert], [project("District Clinic Block B (2,500 m²) From Testimony Letter 1. Construction Cost: 253,000,000.00. Design Cost: 800,000.00.")]);
    assert.doesNotMatch(md, /Cost|253,000,000|800,000|Testimony/);
    assert.match(md, /2,500 m²/);
  });
});
