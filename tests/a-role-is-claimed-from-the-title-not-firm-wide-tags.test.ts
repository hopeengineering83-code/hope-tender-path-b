// A person is named to a role only when their own title holds it.
//
// Delivered proposal (Preview run 36040407147, 2026-09-24):
//
//   Personnel loading:  "2 Lead Architect  Daniel Getachew  Senior Electrical …"
//   Phase narrative:    "Phase lead: Daniel Getachew Tadesse (Senior Electrical
//                        Engineer). Accountable role: Architect."
//   Loading/organogram: "Assignee confirmed at inception" rows for MEP,
//                        Structural and Quantity Surveying.
//
// tests/phase-lead-holds-the-role-it-is-named-for.test.ts already forbade the
// phase misattribution, and passed, because its fixture gave the electrical
// engineer the discipline ["Electrical"]. The real record carries the firm's
// boilerplate discipline list, "Architecture" first, on every CV. Each role
// lookup read title + disciplines + profile, so "architect" matched everybody.
// Role claims now read the title only, and a role nobody holds is left out
// instead of being filled with a placeholder.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildPersonnelLoadingTable, buildOrganogram, buildPerExpertProfileCards } from "../lib/engine/personnel-deep";
import { buildPhaseNarrative } from "../lib/engine/deliverable-and-phases";
import { titleStatesRole } from "../lib/engine/requirement-constraints";
import type { ExpertRecord } from "../lib/engine/benchmark-tables";

// Every record carries the same firm-wide tags, as the real vault does.
const BOILERPLATE = JSON.stringify(["Architecture", "Urban Planning", "Electrical Engineering", "Structural Engineering", "Quantity Surveying"]);
function expert(fullName: string, title: string, yearsExperience = 10): ExpertRecord {
  return { fullName, title, disciplines: BOILERPLATE, sectors: JSON.stringify(["Healthcare"]), profile: "Worked alongside architects and engineers on hospital projects.", yearsExperience } as unknown as ExpertRecord;
}

const TEAM = [
  expert("G. Manager", "General Manager & Practicing Professional Engineer", 11),
  expert("E. Electric", "Senior Electrical Engineer", 11),
  expert("V. Enviro", "Senior Environmental & Electrical Expert", 9),
  expert("A. Designer", "Senior Architect & Urban Planner", 8),
  expert("S. Water", "Senior Sanitary Engineer", 7),
];

function rowFor(table: string, name: string): string | undefined {
  return table.split("\n").find((line) => line.includes(name));
}

describe("titleStatesRole", () => {
  it("matches a role word at the start of a word in the title", () => {
    assert.equal(titleStatesRole("Senior Architect & Urban Planner", "architect"), true);
    assert.equal(titleStatesRole("Project Manager / Senior Civil Engineer", "manager"), true);
    assert.equal(titleStatesRole("Senior Electrical Engineer", "architect"), false);
    assert.equal(titleStatesRole("Medical Equipment Planner", "pm"), false, "a fragment inside a word is not a role");
    assert.equal(titleStatesRole(null, "architect"), false);
  });
});

describe("the personnel loading table", () => {
  const table = buildPersonnelLoadingTable({ experts: TEAM, primarySector: "Healthcare" });

  it("names the architect as the architect, and nobody else", () => {
    for (const line of table.split("\n").filter((l) => /Architect/.test(l.split("|")[2] ?? ""))) {
      assert.match(line, /A\. Designer/, `an architect role went to someone who is not one: ${line}`);
    }
    assert.doesNotMatch(rowFor(table, "E. Electric") ?? "", /\| (Lead|Senior Healthcare) Architect \|/);
    assert.doesNotMatch(rowFor(table, "V. Enviro") ?? "", /\| (Lead|Senior Healthcare) Architect \|/);
  });

  it("lists every proposed expert and no placeholder rows", () => {
    for (const e of TEAM) assert.ok(rowFor(table, e.fullName), `${e.fullName} is missing from the table`);
    assert.doesNotMatch(table, /confirmed at inception/i);
  });

  it("prints nothing for an empty team", () => {
    assert.equal(buildPersonnelLoadingTable({ experts: [], primarySector: "Healthcare" }), "");
  });
});

describe("the organogram", () => {
  const org = buildOrganogram({ experts: TEAM, primarySector: "Healthcare" });

  it("puts nobody in the architecture stream whose title is not architect", () => {
    const stream = org.split("\n").find((l) => l.includes("Architecture Stream")) ?? "";
    assert.doesNotMatch(stream, /E\. Electric|V\. Enviro|S\. Water/);
    assert.match(stream, /A\. Designer/);
  });

  it("carries no placeholder members, and keeps every proposed expert", () => {
    assert.doesNotMatch(org, /Assignee confirmed at inception/);
    for (const e of TEAM) assert.ok(org.includes(e.fullName), `${e.fullName} is missing from the organogram`);
  });
});

describe("the phase narrative", () => {
  it("does not name the electrical engineer as the Architect when every CV is tagged Architecture", () => {
    const withoutArchitect = TEAM.filter((e) => e.fullName !== "A. Designer");
    const narrative = buildPhaseNarrative({ experts: withoutArchitect, primarySector: "Healthcare" });
    assert.doesNotMatch(narrative, /\*\*Phase lead:\*\*[^.]*\([^)]*\)\.\s*\*\*Accountable role:\*\*[^.]*Architect/, narrative);
  });
});

describe("the expert profile cards state only what the expert's own record holds", () => {
  const withCv = [
    { ...expert("S. Water", "Senior Sanitary Engineer", 7), profile: "Lead sanitary engineer on the Dr Abdul Seid General Hospital. Tools: WaterCAD, AutoCAD." },
    { ...expert("E. Electric", "Senior Electrical Engineer", 11), profile: "Electrical design for the Dessie Museum renovation. Tools: ETAP, DIALux." },
  ] as ExpertRecord[];
  const projects = [
    { name: "G+6 General Hospital – Dr Abdul Seid", sector: "Healthcare", contractValue: 550000000, currency: "ETB" },
    { name: "Dessie Specialized Hospital", sector: "Healthcare" },
    { name: "Hospital Project", sector: "Healthcare" },
  ] as Parameters<typeof buildPerExpertProfileCards>[0]["projects"];
  const cards = buildPerExpertProfileCards({ experts: withCv, projects, primarySector: "Healthcare" });
  const card = (name: string) => cards.split("### ").find((c) => c.includes(name)) ?? "";

  it("claims no attached declaration the submission does not carry", () => {
    assert.doesNotMatch(cards, /Appendix|CONFIRMED AVAILABLE|declaration filed/i);
  });

  it("lists a project only when the person's own CV names it", () => {
    assert.match(card("S. Water"), /Dr Abdul Seid/);
    assert.doesNotMatch(card("E. Electric"), /Abdul Seid|Dessie Specialized|Hospital Project/,
      "a hospital was claimed for an expert whose CV names none, via the shared Healthcare tag");
  });

  it("lists software only when the person's own CV names it", () => {
    assert.match(card("E. Electric"), /ETAP/);
    assert.doesNotMatch(card("E. Electric"), /Revit|ETABS|SketchUp/);
  });

  it("does not present the discipline list as education or the title as a licence", () => {
    assert.doesNotMatch(cards, /Education and Years of Practice/);
    assert.doesNotMatch(cards, /\| Licence \/ Certification \| Senior/);
  });
});
