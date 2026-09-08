import { test } from "node:test";
import assert from "node:assert/strict";

import { buildPhaseNarrative } from "../lib/engine/deliverable-and-phases";
import { canonicalWorkPlan } from "../lib/engine/canonical-work-plan";
import type { ExpertRecord } from "../lib/engine/benchmark-tables";

/**
 * A delivered proposal named a real, verified person as accountable for a
 * discipline they do not hold:
 *
 *   Phase lead: Daniel Getachew Tadesse (Senior Electrical Engineer).
 *   Accountable role: Architect.
 *
 * The phase-lead lookup appended a generic seniority tail to every role's
 * keywords — "principal", "director", "lead", "senior", "engineer",
 * "specialist" — and then fell back to the first unused expert, so a phase
 * always named somebody whether or not anyone held the role. On a vault with
 * no architect, the Architect phase matched on "senior".
 *
 * An evaluator checking the named CV finds this immediately, and it is a
 * factual misstatement about an identifiable individual rather than a
 * presentation flaw.
 */

function expert(fullName: string, title: string, disciplines: string[]): ExpertRecord {
  return { fullName, title, disciplines: JSON.stringify(disciplines), profile: "" } as unknown as ExpertRecord;
}

// The real team behind the failing proposal: no architect, no resident engineer.
const TEAM_WITHOUT_AN_ARCHITECT = [
  expert("Ahmed Kebede Tekaw", "General Manager & Practicing Professional Engineer", ["Civil"]),
  expert("Daniel Getachew Tadesse", "Senior Electrical Engineer", ["Electrical"]),
  expert("Eng. Kemal Mohammed Zeinu", "Senior Environmental & Electrical Expert", ["Environmental"]),
];

test("nobody is named as the lead for a role they do not hold", () => {
  const narrative = buildPhaseNarrative({
    experts: TEAM_WITHOUT_AN_ARCHITECT,
    primarySector: "Healthcare",
  });

  // The exact misattribution the delivered proposal made.
  assert.ok(
    !/Daniel Getachew Tadesse[^.]*\.\s*\*\*Accountable role:\*\*\s*Architect/.test(narrative),
    "an electrical engineer is still being named as the Architect",
  );

  // Every "Phase lead" that IS named must share a word with its own role.
  const blocks = narrative.split(/^### /m).slice(1);
  for (const block of blocks) {
    const lead = /\*\*Phase lead:\*\*\s*([^.]+)\./.exec(block);
    const role = /\*\*Accountable role:\*\*\s*([^.—]+)/.exec(block);
    if (!lead || !role) continue;
    const roleWords = role[1].toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3 && w !== "team");
    assert.ok(
      roleWords.some((word) => lead[1].toLowerCase().includes(word)),
      `"${lead[1].trim()}" is named for the role "${role[1].trim()}" and matches none of its words`,
    );
  }
});

test("a phase with no matching expert defers the assignment instead of inventing one", () => {
  const narrative = buildPhaseNarrative({ experts: [], primarySector: "Roads and Bridges" });
  for (const phase of canonicalWorkPlan({ sector: "Roads and Bridges" })) {
    assert.ok(narrative.includes(phase.title), `the plan lost "${phase.title}"`);
  }
  assert.ok(!narrative.includes("**Phase lead:**"), "a lead was named from an empty team");
  assert.ok(narrative.includes("confirmed at inception"));
  assert.ok(!narrative.includes("Bid-Team Action"), "internal action language must not reach the client");
});

test("the narrative promises only what it delivers", () => {
  // It used to say "names the responsible expert", which reads as an omission
  // on the phases that honestly defer the assignment.
  const narrative = buildPhaseNarrative({ experts: TEAM_WITHOUT_AN_ARCHITECT, primarySector: "Healthcare" });
  assert.ok(narrative.includes("names the accountable role"));
  assert.ok(!narrative.includes("names the responsible expert"));
});

test("no engagement window is asserted that the tender never stated", () => {
  // This defaulted to 90 days, so the narrative claimed "over an indicative
  // 90-day engagement window" on tenders that state no programme at all — and
  // rescaled every phase to day numbers, leaving the same phase reading
  // "Weeks 1-2" in the work-plan table and "Days 1-13" here.
  const silent = buildPhaseNarrative({ experts: [], primarySector: "Healthcare" });
  assert.ok(!/\d+-day engagement window/.test(silent), "an unsourced day count is still asserted");
  assert.ok(!/Days \d+/.test(silent), "phases were rescaled to days the tender never stated");
  for (const phase of canonicalWorkPlan({ sector: "Healthcare" })) {
    assert.ok(silent.includes(phase.durationLabel), `narrative disagrees with the plan on "${phase.title}"`);
  }

  // When the tender DOES state one, both speak it.
  const stated = buildPhaseNarrative({ experts: [], primarySector: "Healthcare", totalDays: 60 });
  assert.ok(stated.includes("over 60 calendar days"));
  for (const phase of canonicalWorkPlan({ sector: "Healthcare", totalDays: 60 })) {
    assert.ok(stated.includes(phase.durationLabel), `narrative disagrees with the rescaled plan on "${phase.title}"`);
  }
});

test("a rule that applies to every phase is stated once, not five times", () => {
  // The delivered proposal repeated these two sentences verbatim in all five
  // phases, over two pages:
  //
  //   "Quality is gated inside the phase — the deliverable is peer-reviewed
  //    against the applicable standards and the tender's own requirements
  //    before it is issued. Phase exit gate: client sign-off on the phase
  //    deliverable before the next phase begins."
  //
  // Ten identical sentences read as padding and crowd out the only part of a
  // phase an evaluator scores: what it produces and who is accountable.
  for (const sector of ["Healthcare", "Roads and Bridges", "Water Supply"]) {
    const narrative = buildPhaseNarrative({ experts: TEAM_WITHOUT_AN_ARCHITECT, primarySector: sector });

    const sentences = narrative
      .split(/(?<=\.)\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 45);
    const counts = new Map<string, number>();
    for (const sentence of sentences) counts.set(sentence, (counts.get(sentence) ?? 0) + 1);
    const repeated = [...counts.entries()].filter(([, n]) => n > 1);
    assert.deepEqual(repeated, [], `${sector}: a sentence is repeated across phases`);

    // The rule is still stated — once, in the preamble, before any phase.
    const preamble = narrative.split("### ")[0];
    assert.match(preamble, /peer-reviewed against the applicable standards/);
    assert.match(preamble, /written client sign-off before the next begins/);

    // Every phase still says what it produces.
    for (const phase of canonicalWorkPlan({ sector })) {
      assert.ok(narrative.includes(phase.title), `${sector}: lost "${phase.title}"`);
    }
    assert.equal(
      (narrative.match(/This phase produces:/g) ?? []).length,
      canonicalWorkPlan({ sector }).length,
      `${sector}: not every phase states its artefacts`,
    );
  }
});
