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
