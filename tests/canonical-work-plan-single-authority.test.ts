import { test } from "node:test";
import assert from "node:assert/strict";

import { canonicalWorkPlan } from "../lib/engine/canonical-work-plan";
import { buildPhaseNarrative } from "../lib/engine/deliverable-and-phases";

/**
 * A delivered technical proposal said both of these, nine pages apart:
 *
 *   C.13 "The engagement is delivered in 5 phases, each with a defined
 *         deliverable, duration, and responsible expert."
 *   C.16 "The methodology is delivered across 6 phases over an indicative
 *         90-day engagement window."
 *
 * Two builders each owned a private phase list. There is now one, and these
 * tests assert the property that makes the contradiction structurally
 * impossible rather than merely absent: every representation reports the same
 * count, the same titles, the same durations and the same accountable roles.
 *
 * Run across sectors because the spine is sector-specific and a single-sector
 * test would prove nothing about the others.
 */

const SECTORS = [
  "Healthcare facility design",
  "Road and highway rehabilitation",
  "Water supply and sanitation",
  "Urban master planning",
  "Geotechnical site investigation",
  "Construction supervision",
  "Contract administration",
  "Industrial processing facility",
  "Interior design and fit-out",
  "Hotel and hospitality",
  "Something with no matching sector branch at all",
];

function phaseCountClaimedInProse(text: string): number | null {
  const match = /delivered (?:in|across) (\d+) phases/i.exec(text);
  return match ? Number(match[1]) : null;
}

test("the plan is non-empty and self-consistent for every sector", () => {
  for (const sector of SECTORS) {
    const plan = canonicalWorkPlan({ sector });
    assert.ok(plan.length > 0, sector);
    plan.forEach((phase, i) => {
      assert.equal(phase.index, i + 1, sector);
      assert.ok(phase.title.trim().length > 0, sector);
      assert.ok(phase.deliverables.trim().length > 0, sector);
      assert.ok(phase.durationLabel.trim().length > 0, sector);
      assert.ok(phase.responsibleRole.trim().length > 0, sector);
      assert.ok(phase.leadKeywords.length > 0, sector);
    });
  }
});

test("the narrative states the canonical phase count, in every sector", () => {
  for (const sector of SECTORS) {
    const plan = canonicalWorkPlan({ sector });
    const narrative = buildPhaseNarrative({ experts: [], primarySector: sector, totalDays: 90 });
    assert.equal(phaseCountClaimedInProse(narrative), plan.length, sector);
  }
});

test("the narrative names every canonical phase, with its duration and role", () => {
  for (const sector of SECTORS) {
    const plan = canonicalWorkPlan({ sector, totalDays: 90 });
    const narrative = buildPhaseNarrative({ experts: [], primarySector: sector, totalDays: 90 });
    for (const phase of plan) {
      assert.ok(narrative.includes(phase.title), `${sector}: missing "${phase.title}"`);
      assert.ok(narrative.includes(phase.durationLabel), `${sector}: missing "${phase.durationLabel}"`);
      assert.ok(narrative.includes(phase.responsibleRole), `${sector}: missing "${phase.responsibleRole}"`);
    }
    // And no phase the plan does not contain.
    // Greedy up to the LAST em dash: a phase title may contain one of its own
    // ("2. Construction Phase — Quality & Progress").
    const headings = [...narrative.matchAll(/^### (.+) — /gm)].map((m) => m[1]);
    assert.deepEqual(headings, plan.map((p) => p.title), sector);
  }
});

test("a tender that states its own duration rescales the whole plan, not one view of it", () => {
  const plan = canonicalWorkPlan({ sector: "Road and highway rehabilitation", totalDays: 28 });
  const narrative = buildPhaseNarrative({ experts: [], primarySector: "Road and highway rehabilitation", totalDays: 28 });
  assert.ok(plan.some((p) => /Day/.test(p.durationLabel)), "durations should speak the tender's units");
  for (const phase of plan) {
    assert.ok(narrative.includes(phase.durationLabel), `narrative missing rescaled "${phase.durationLabel}"`);
  }
});

test("sector branches stay distinct — no sector inherits another's plan", () => {
  const health = canonicalWorkPlan({ sector: "Healthcare facility design" });
  const road = canonicalWorkPlan({ sector: "Road and highway rehabilitation" });
  const water = canonicalWorkPlan({ sector: "Water supply and sanitation" });

  const joined = (plan: readonly { deliverables: string }[]) => plan.map((p) => p.deliverables).join(" ").toLowerCase();
  assert.match(joined(health), /medical-gas|clinical|ipc/);
  assert.match(joined(road), /pavement|aashto|subgrade|traffic/);
  assert.match(joined(water), /borehole|hydraulic|pressure-test|yield/);

  // No leakage in the other direction: a road plan must not carry clinical
  // vocabulary just because healthcare was the benchmark that exposed the bug.
  assert.doesNotMatch(joined(road), /clinical|medical-gas|\bipc\b/);
  assert.doesNotMatch(joined(water), /clinical|medical-gas/);
  assert.doesNotMatch(joined(health), /pavement|aashto/);
});

test("phase leads are drawn from the vault, and repeat only when it runs out", () => {
  const experts = [
    { fullName: "A. Principal", title: "Project Principal", disciplines: "", profile: "" },
    { fullName: "B. Resident", title: "Resident Engineer", disciplines: "", profile: "" },
    { fullName: "C. Architect", title: "Architect", disciplines: "", profile: "" },
  ] as Parameters<typeof buildPhaseNarrative>[0]["experts"];
  const narrative = buildPhaseNarrative({ experts, primarySector: "Healthcare facility design", totalDays: 90 });
  assert.ok(narrative.includes("A. Principal"));
  assert.ok(narrative.includes("B. Resident"));
});
