/**
 * One work plan, not three.
 *
 * A delivered proposal carried three phase lists that contradicted each other
 * within twelve pages:
 *
 *   C.4  "Phase 1: Site / Premises Assessment" ... "Phase 6: Close-Out"
 *        (six phases, "1 to 2 weeks" / "8 to 12 weeks")
 *   C.13 "The engagement is delivered in 5 phases"
 *        (Inception ... Close-out, "Weeks 1-2" / "Weeks 7-14")
 *   C.16 "The methodology is delivered across 5 phases"
 *        (the same five, "Days 1-13" / "Days 40-90")
 *
 * An evaluator scoring the work plan cannot tell which one is the offer, and
 * two of the three are wrong by construction. These tests pin the property
 * that makes the contradiction impossible rather than merely unlikely: every
 * representation renders canonical-work-plan.ts, and only one phase table is
 * ever emitted.
 *
 * Sector coverage is deliberately non-healthcare-first — the benchmark that
 * exposed this was a healthcare tender, but the defect was generic.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalWorkPlan, tenderTotalDays } from "../lib/engine/canonical-work-plan";
import { buildWorkPlanTable } from "../lib/engine/work-plan-timeline";
import { buildPhaseNarrative } from "../lib/engine/deliverable-and-phases";
import { injectMethodologyTables } from "../lib/engine/methodology-tables";

const SECTORS = ["Road and Highway", "Water Supply", "Environmental / ESIA", "Urban Planning", "Healthcare"];

test("the work plan table names exactly the canonical phases, in every sector", () => {
  for (const sector of SECTORS) {
    const phases = canonicalWorkPlan({ sector });
    const table = buildWorkPlanTable({ primarySector: sector });

    for (const phase of phases) {
      assert.ok(table.includes(phase.title), `${sector}: table is missing phase "${phase.title}"`);
      assert.ok(table.includes(phase.durationLabel), `${sector}: table is missing duration "${phase.durationLabel}"`);
      assert.ok(table.includes(phase.responsibleRole), `${sector}: table is missing role "${phase.responsibleRole}"`);
    }

    // The row count is the phase count — no extra phase invented by the table.
    const rowCount = table.split("\n").filter((line) => /^\|\s*\d+\./.test(line.trim())).length;
    assert.equal(rowCount, phases.length, `${sector}: table row count disagrees with the canonical plan`);
  }
});

test("the table states the same phase count the narrative states", () => {
  for (const sector of SECTORS) {
    const count = canonicalWorkPlan({ sector }).length;
    assert.ok(
      buildWorkPlanTable({ primarySector: sector }).includes(`delivered in ${count} phases`),
      `${sector}: table does not state ${count} phases`,
    );
    assert.ok(
      buildPhaseNarrative({ experts: [], primarySector: sector }).includes(`across ${count} phases`),
      `${sector}: narrative does not state ${count} phases`,
    );
  }
});

test("table and narrative speak the tender's own units", () => {
  const totalDays = tenderTotalDays("The assignment shall be completed within 60 calendar days of contract signature.");
  assert.equal(totalDays, 60);

  const table = buildWorkPlanTable({ primarySector: "Road and Highway", totalDays });
  const narrative = buildPhaseNarrative({ experts: [], primarySector: "Road and Highway", totalDays });

  // Every rescaled duration cell is the SAME string in both representations.
  for (const phase of canonicalWorkPlan({ sector: "Road and Highway", totalDays })) {
    assert.ok(table.includes(phase.durationLabel), `table is missing "${phase.durationLabel}"`);
    assert.ok(narrative.includes(phase.durationLabel), `narrative is missing "${phase.durationLabel}"`);
  }
  assert.ok(table.includes("over 60 calendar days"));
});

test("the work plan module holds no private phase list of its own", () => {
  const source = readFileSync(join(process.cwd(), "lib/engine/work-plan-timeline.ts"), "utf8");
  const body = source.split('import { canonicalWorkPlan }')[1] ?? source;
  assert.ok(!/"Phase\s+\d+:/.test(body), "a private phase list has come back into work-plan-timeline.ts");
  assert.ok(!/phasesForSector/.test(body), "phasesForSector has come back into work-plan-timeline.ts");
});

test("a document already carrying the work plan table is not given a second one", () => {
  const markdown = [
    "# Section C: Technical Approach",
    "",
    buildWorkPlanTable({ primarySector: "Water Supply" }),
    "",
    "# Section D: Additional Information",
  ].join("\n");

  const result = injectMethodologyTables(markdown, {
    primarySector: "Water Supply",
    experts: [],
    projects: [],
  });

  assert.equal(result.injected.find((i) => i.key === "phasing")?.reason, "SKIPPED_PRESENT");
  assert.ok(!result.markdown.includes("## Project Phasing and Deliverables"));

  // Exactly one phase table survives, and it is the canonical one.
  const firstPhase = canonicalWorkPlan({ sector: "Water Supply" })[0];
  assert.equal(result.markdown.split(firstPhase.title).length - 1, 1);
});

test("a document with no phase table still gets one", () => {
  const result = injectMethodologyTables("# Section C: Technical Approach\n\nProse only.\n", {
    primarySector: "Road and Highway",
    experts: [],
    projects: [],
  });
  assert.equal(result.injected.find((i) => i.key === "phasing")?.reason, "MISSING");
  assert.ok(result.markdown.includes(canonicalWorkPlan({ sector: "Road and Highway" })[0].title));
});

test("tenderTotalDays reads a programme, not a notice period", () => {
  assert.equal(tenderTotalDays("Bids must be submitted 14 days before the deadline."), undefined);
  assert.equal(tenderTotalDays("A 3 day validation window applies."), undefined);
  assert.equal(tenderTotalDays("No duration is stated anywhere in this tender."), undefined);

  assert.equal(tenderTotalDays("Services shall be delivered within 28 calendar days."), 28);
  assert.equal(tenderTotalDays("Contract period: 180 working days."), 180);
});

/**
 * A phase row must never carry a word the price-separation guard deletes.
 *
 * On a two-envelope tender the guard removes any line pairing a priced term
 * with a number, and a phase row always carries a number in its duration cell.
 * "BOQ" was such a term in twenty rows across fifteen sectors of the spine —
 * the healthcare timeline had already lost a phase to exactly this, delivering
 * a work plan that read Phase 1, 2, 3, 5, 6. The guard is right and the word
 * was wrong: the deliverable is a quantity schedule, and the rest of the app
 * already calls it that.
 *
 * This walks every sector rather than a fixture, so a phase added later cannot
 * quietly reintroduce it.
 */
test("no phase row is deletable by the price-separation guard", () => {
  const allSectors = [
    ...SECTORS,
    "Power Systems", "Mining", "Irrigation", "Ports and Marine", "Oil and Gas Pipelines",
    "Telecommunications", "Interior Design", "Construction Supervision", "Contract Administration",
    "Heritage Conservation", "Industrial Facilities", "High-Rise Buildings", "Hospitality and Tourism",
    "Geotechnical Investigation", "Financial Regulatory Systems", "Education Facilities",
  ];

  for (const sector of allSectors) {
    for (const phase of canonicalWorkPlan({ sector })) {
      const row = `${phase.title} ${phase.deliverables} ${phase.durationLabel} ${phase.responsibleRole}`;
      assert.ok(
        !/\bBOQ\b/i.test(row),
        `${sector} — "${phase.title}" says BOQ; the guard deletes the whole row on a two-envelope tender`,
      );
    }
  }
});
