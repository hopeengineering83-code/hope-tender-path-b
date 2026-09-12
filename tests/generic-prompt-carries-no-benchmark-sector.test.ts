import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The Pharo tender is the acceptance benchmark, not the product. The product is
 * a general tender proposal generator: road, water, geotechnical, urban
 * planning, industrial, education, donor/EOI and healthcare assignments all go
 * through the same writer.
 *
 * THE DELIVERED DEFECT
 * --------------------
 * The shared writing prompt in lib/ai.ts — the part every tender receives,
 * whatever its sector — carried the benchmark's own sector as its worked
 * examples. The WEAK/STRONG writing pair, the "top evaluation driver" hint and
 * the A.4, A.5, B.1, B.2, E, F, G and H table shapes were all hospital rows. A
 * road tender was primed with hospital examples on every generation, which
 * makes one benchmark's sector the permanent default.
 *
 * Worse, the examples asserted company credentials that do not exist. The
 * "STRONG (write like this)" paragraph named "St. Paul's Hospital Millennium
 * Medical College specialist wing (ETB 312M)" and "Dr. Almaz Tadesse (Lead
 * Architect, EIASC Grade A)"; Section G asserted "two completed G+6 hospitals".
 * Read against the live vault — 114 source-verified projects, 28 source-verified
 * experts — none of those exist and only one G+6 hospital does. A model told
 * "every paragraph must contain at least one specific, verifiable fact from the
 * evidence" was being shown that inventing a plausible project, value, expert
 * and licence is what "strong" looks like.
 *
 * These identities remain legitimate as TEST FIXTURES for sanitizers (see
 * tests/pricing-hygiene-reference-values.test.ts and quality-gaps-phase4), which
 * is why this test reads the shipped prompt source rather than banning the
 * strings repository-wide.
 */

const AI_SOURCE = readFileSync(new URL("../lib/ai.ts", import.meta.url), "utf8");

// Identities that were fabricated or benchmark-specific in the shared prompt.
const BENCHMARK_IDENTITIES = [
  "Abdul Seid",
  "St. Paul",
  "Almaz Tadesse",
  "Gimba",
  "Tariku Abebaw",
  "ETB 550",
  "ETB 312",
];

test("the shared writer prompt names no benchmark project, client or expert", () => {
  for (const identity of BENCHMARK_IDENTITIES) {
    assert.ok(
      !AI_SOURCE.includes(identity),
      `lib/ai.ts still carries "${identity}". A worked example in the shared ` +
        `prompt is shown to every tender regardless of sector, and this one ` +
        `names a specific project/expert as though it were company evidence.`,
    );
  }
});

test("sector guidance is activated by the tender, never applied unconditionally", () => {
  // Each sector's mandatory guidance must be gated on its own detection flag,
  // so a water tender gets water guidance and a road tender gets road guidance.
  // A block assigned without a condition would apply that sector to everything.
  const gated = AI_SOURCE.match(/const [a-zA-Z]+Guidance = (?:is[A-Za-z]+|\(is)/g) ?? [];
  const declared = AI_SOURCE.match(/const [a-zA-Z]+Guidance = /g) ?? [];
  // allSectorGuidance is the composed array of the gated blocks, not a sector.
  assert.equal(
    declared.length - gated.length,
    1,
    "every *Guidance block except the composed allSectorGuidance array must be " +
      "gated on a sector-detection flag",
  );
  assert.match(AI_SOURCE, /const healthcareGuidance = isHealthcare/);
  assert.match(AI_SOURCE, /const roadBridgeGuidance = isRoadBridge/);
  assert.match(AI_SOURCE, /const waterGuidance = isWater/);
  assert.match(AI_SOURCE, /const geotechnicalGuidance = isGeotechnical/);
  assert.match(AI_SOURCE, /const urbanGuidance = isUrban/);
});

test("the examples tell the writer they are shape, not evidence", () => {
  // The pedagogical contrast is worth keeping; what it must not do is let a
  // model mistake an illustrative name for a fact it may assert.
  assert.match(AI_SOURCE, /the examples below are SHAPE, never CONTENT/);
  assert.match(AI_SOURCE, /Never copy a project name, contract value, expert name, licence, client or date/);
});

test("the writer is still taught to be specific, not vague", () => {
  // Removing invented specifics must not turn the standard into "write vaguely".
  assert.match(AI_SOURCE, /named assignment \+ measurable scale \+ contract value/);
  assert.match(AI_SOURCE, /Every paragraph must contain at least one specific, verifiable fact from the evidence/);
});
