/**
 * The client's mission and address are not the assignment's sector.
 *
 * 2026-10-05 hands-off acceptance: an architectural office-space EOI from a
 * global-health non-profit shipped a hospital proposal — a "clinical brief"
 * inception, IPC flow audits, medical-gas hold points, patient-flow simulation,
 * "Clinical workflows are designed from the patient perspective" — because the
 * client's mission statement said "health". It also carried a "C.8 Hospitality
 * & Tourism Facilities" section with guestroom mock-ups and RevPAR
 * benchmarking, because the document-collection address read "behind The HUB
 * Hotel". The work plan's interior/office branch existed but no sector label
 * could reach it.
 *
 * Generic fixtures: a fictional health alliance, a water utility, a road
 * authority, a district hospital and a lakeside hotel.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { assignmentSubjectText } from "../lib/engine/assignment-subject";
import { detectThemes, inferSector, INTERIOR_FIT_OUT_SECTOR } from "../lib/engine/proposal-intelligence";
import { canonicalWorkPlan } from "../lib/engine/canonical-work-plan";
import { classifyUniversalTender } from "../lib/engine/universal-tender-taxonomy";
import { isHealthcareSector } from "../lib/engine/assignment-subject";
import { readdirSync } from "node:fs";

const OFFICE_TITLE = "Architectural Design, Floor Plan and Modeling of Office Space";
const OFFICE = [
  OFFICE_TITLE,
  "Northlight Health Alliance is a global non-profit organization dedicated to achieving health equity through innovation.",
  "The Alliance seeks a qualified firm to prepare the architectural design, floor plan and 3D modeling of its new office space, including interior layout, partitions, furniture layout and energy-efficient lighting.",
  "Physical Address for Document Collection: Kebele 07, behind The Summit Hotel, Riverbend Town.",
  "Bidders shall submit a Health and Safety Plan. Gifts and hospitality offered to staff are prohibited. Complaints may be lodged with the procurement unit as a last resort.",
].join("\n");

describe("assignmentSubjectText", () => {
  it("removes a landmark, a labelled address, the client's self-description and non-sector phrases", () => {
    const subject = assignmentSubjectText(OFFICE);
    assert.doesNotMatch(subject, /Summit Hotel|global non-profit|health equity|Health and Safety|hospitality|last resort/i);
    assert.match(subject, /office space, including interior layout/);
  });
});

describe("inferSector reads what is being bought", () => {
  it("an office-space design for a health non-profit is interior/office work, not healthcare or hospitality", () => {
    for (const sector of [inferSector(OFFICE, { title: OFFICE_TITLE }), inferSector(OFFICE)]) {
      assert.equal(sector, INTERIOR_FIT_OUT_SECTOR);
    }
  });

  it("the work plan for that sector is the interior/office plan", () => {
    const phases = canonicalWorkPlan({ sector: INTERIOR_FIT_OUT_SECTOR }).map((p) => p.title);
    assert.match(phases[0] ?? "", /Space Programming/);
    assert.ok(!phases.some((p) => /clinical|IPC/i.test(p)));
  });

  it("an office building for a health bureau is building work", () => {
    assert.match(inferSector("Design of G+5 office building for the Regional Health Bureau. Health and safety plan required.", { title: "Design of Office Building for the Regional Health Bureau" }), /Building Design/);
  });

  it("an engineer's site office in a road contract does not make it interior work", () => {
    assert.match(inferSector("Rehabilitation of 42 km gravel road. The contractor shall provide office space for the Engineer.", { title: "Road Rehabilitation Works" }), /Road/);
  });

  it("real healthcare and hospitality work still classify", () => {
    assert.match(inferSector("Design and construction supervision of a 120-bed district hospital with outpatient department and maternity ward for the Ministry of Health."), /Healthcare/);
    assert.match(inferSector("District health services and clinical referrals network design"), /Healthcare/);
    assert.match(inferSector("Architectural design of a 4-star hotel with 80 guest rooms, restaurant and conference hall near Lake Tana."), /Hospitality/);
  });
});

describe("themes follow the assignment", () => {
  it("no healthcare or hospitality theme for the office EOI", () => {
    const codes = detectThemes(OFFICE).map((t) => t.code);
    assert.ok(!codes.includes("HEALTHCARE"), codes.join(","));
    assert.ok(!codes.includes("HOSPITALITY_TOURISM"), codes.join(","));
    assert.ok(codes.includes("INTERIOR_DESIGN"), codes.join(","));
  });

  it("a hospital and a hotel still get their themes", () => {
    assert.ok(detectThemes("Design of a 120-bed district hospital with outpatient department and medical gas systems.").some((t) => t.code === "HEALTHCARE"));
    assert.ok(detectThemes("Architectural design of a 4-star hotel with 80 guest rooms near Lake Tana.").some((t) => t.code === "HOSPITALITY_TOURISM"));
  });

  it("an emergency exit and a soil laboratory are not healthcare", () => {
    const codes = detectThemes("Office fit-out with emergency exits and fire alarm. Geotechnical soil laboratory testing of the site.").map((t) => t.code);
    assert.ok(!codes.includes("HEALTHCARE"), codes.join(","));
  });
});

describe("tender classification", () => {
  it("a health-and-safety requirement does not put a tender in the healthcare domain", () => {
    const profile = classifyUniversalTender(`${OFFICE_TITLE}\nHealth and Safety Plan\nCompany profile`);
    assert.ok(!profile.sectorDomains.includes("HEALTHCARE"), profile.sectorDomains.join(","));
    assert.ok(classifyUniversalTender("Rehabilitation of the district hospital outpatient block").sectorDomains.includes("HEALTHCARE"));
  });
});

describe("no raw-text healthcare switch remains in the writers", () => {
  it("the generator's healthcare flag reads the inferred sector", () => {
    const source = readFileSync("lib/engine/generate-elite.ts", "utf8");
    assert.match(source, /const isHealthcare = isHealthcareSector\(intelligence\.primarySector\);/);
  });

  it("sector methodology reads the tender, not the firm's own portfolio", () => {
    const source = readFileSync("lib/engine/proposal-strengthening-sections.ts", "utf8");
    assert.match(source, /const text = assignmentSubjectText\(input\.tenderTitle\);/);
    assert.doesNotMatch(source, /input\.projectLines\.join\("\\n"\)\}\\n\$\{input\.companyEvidenceLines/);
  });

  it("the AI prompt's healthcare flag reads the assignment subject", () => {
    const source = readFileSync("lib/ai.ts", "utf8");
    assert.match(source, /const isHealthcare = HEALTHCARE_WORK\.test\(subjectText\)/);
  });
});

describe("a hospitality sector is not a hospital", () => {
  it("isHealthcareSector tells the labels apart", () => {
    assert.equal(isHealthcareSector("Hospitality & Tourism"), false);
    assert.equal(isHealthcareSector("Healthcare / Medical Facility Design"), true);
    assert.equal(isHealthcareSector("District Hospital Design"), true);
  });

  it("a hotel tender gets the hotel work plan, not the clinical one", () => {
    const phases = canonicalWorkPlan({ sector: "Hospitality & Tourism" }).map((p) => `${p.title} ${p.deliverables}`).join("\n");
    assert.doesNotMatch(phases, /clinical|IPC|medical gas/i);
  });

  it("no sector-label check in the engine matches /hospital/ against a label", () => {
    const offenders: string[] = [];
    for (const name of readdirSync("lib/engine")) {
      if (!name.endsWith(".ts")) continue;
      const source = readFileSync(`lib/engine/${name}`, "utf8");
      const re = /\/health\|hospital[^/]*\/i?\.test\((?:s|sector|primarySector|intelligence\.primarySector|opts\.primarySector)\)/g;
      for (const m of source.matchAll(re)) offenders.push(`${name}: ${m[0]}`);
    }
    assert.deepEqual(offenders, []);
  });
});
