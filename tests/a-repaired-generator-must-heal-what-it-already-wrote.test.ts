import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  GENERATOR_CONTENT_CONTRACT_VERSION,
  contractMarker,
  recordedContractVersion,
  withContractMarker,
  decideExistingArtifactRegeneration,
} from "../lib/engine/generated-artifact-staleness";

/**
 * THE DEFECT.
 * -----------
 * missing-plan-file-generation skipped any existing row whose status was not
 * PLANNED:
 *
 *   if (existing && existing.generationStatus !== "PLANNED") {
 *     skipped.push(document.fileName);
 *
 * On 2026-09-20 a methodology artifact written by an early generator as a
 * 367-word stub (800-word floor; missing phases, tasks, deliverables,
 * schedule, qa, risk) was stored as GENERATED. The run that shipped the
 * repaired methodology generator therefore skipped it by name, the artifact
 * stayed 367 words, and it went on blocking the package ZIP. Both dispatch
 * predicates returned true for that file, so the repaired generator WOULD have
 * produced the full narrative had it been asked.
 *
 * Generalised: improving any generator had no effect on any tender that had
 * already been through the pipeline once — which is every tender an owner has
 * ever run.
 *
 * THE RULE PINNED HERE: an artifact written to a superseded generator contract
 * is eligible for one controlled regeneration; a current one is left alone;
 * owner intent is never overwritten; and the pass is idempotent because
 * version equality — not a counter or a score — is the fixpoint.
 *
 * No filename is special-cased. "Technical Approach and Methodology" must not
 * appear in the implementation, and the fixtures below are cross-sector.
 */
describe("a repaired generator must heal what it already wrote", () => {
  const OLD = { generationStatus: "GENERATED", reviewStatus: "NEEDS_REVIEW", contentSummary: "Generated narrative draft for tender-required file." };

  it("regenerates an artifact that predates the contract entirely", () => {
    const decision = decideExistingArtifactRegeneration(OLD);
    assert.equal(decision.regenerate, true);
    assert.match(decision.reason, /no generator contract|predates/i);
  });

  it("regenerates an artifact written to an older contract", () => {
    const decision = decideExistingArtifactRegeneration({
      ...OLD,
      contentSummary: `Generated narrative draft. ${contractMarker(GENERATOR_CONTENT_CONTRACT_VERSION - 1)}`,
    });
    assert.equal(decision.regenerate, true);
    assert.match(decision.reason, new RegExp(`v${GENERATOR_CONTENT_CONTRACT_VERSION - 1}`));
  });

  it("leaves a current, passing artifact alone — no needless churn", () => {
    const decision = decideExistingArtifactRegeneration({
      ...OLD,
      contentSummary: withContractMarker("Generated narrative draft."),
    });
    assert.equal(decision.regenerate, false);
    assert.match(decision.reason, /current|needless/i);
  });

  it("IS IDEMPOTENT: regenerating once makes the next pass skip it", () => {
    // pass 1: stale -> regenerate, and the write stamps the current contract
    const before = OLD.contentSummary;
    assert.equal(decideExistingArtifactRegeneration({ ...OLD, contentSummary: before }).regenerate, true);
    const after = withContractMarker(before);
    // pass 2 and 3: the fixpoint holds, so there is no regeneration loop
    assert.equal(decideExistingArtifactRegeneration({ ...OLD, contentSummary: after }).regenerate, false);
    assert.equal(withContractMarker(after), after, "stamping twice must not duplicate the marker");
    assert.equal(recordedContractVersion(after), GENERATOR_CONTENT_CONTRACT_VERSION);
  });

  it("regenerates a current artifact only when it actually fails quality", () => {
    const current = withContractMarker("Generated narrative draft.");
    assert.equal(decideExistingArtifactRegeneration({ ...OLD, contentSummary: current, failsCurrentQuality: false }).regenerate, false);
    const failing = decideExistingArtifactRegeneration({ ...OLD, contentSummary: current, failsCurrentQuality: true });
    assert.equal(failing.regenerate, true);
    assert.match(failing.reason, /fails the current quality rules/i);
  });

  it("NEVER overwrites owner intent", () => {
    for (const reviewStatus of ["REPLACE_WITH_ORIGINAL", "SUPERSEDED"]) {
      const decision = decideExistingArtifactRegeneration({ ...OLD, reviewStatus, contentSummary: null });
      assert.equal(decision.regenerate, false, `${reviewStatus} was overwritten`);
      assert.match(decision.reason, /owner intent/i);
    }
  });

  it("never regenerates a PLANNED or SUPERSEDED row through this path", () => {
    assert.equal(decideExistingArtifactRegeneration({ ...OLD, generationStatus: "PLANNED" }).regenerate, false);
    assert.equal(decideExistingArtifactRegeneration({ ...OLD, generationStatus: "SUPERSEDED" }).regenerate, false);
  });

  it("always states a reason, for a skip as much as for a rewrite", () => {
    const cases = [
      { ...OLD },
      { ...OLD, contentSummary: withContractMarker("x") },
      { ...OLD, reviewStatus: "REPLACE_WITH_ORIGINAL" },
      { ...OLD, generationStatus: "PLANNED" },
    ];
    for (const input of cases) {
      assert.ok(decideExistingArtifactRegeneration(input).reason.length > 20);
    }
  });

  it("the generator path consults the contract and records it, without duplicating rows", () => {
    const src = readFileSync("lib/engine/missing-plan-file-generation.ts", "utf8");
    assert.match(src, /decideExistingArtifactRegeneration\(/);
    assert.match(src, /withContractMarker\(/);
    // The bare unconditional skip must be gone.
    assert.equal(
      /if \(existing && existing\.generationStatus !== "PLANNED"\) \{\s*skipped\.push\(document\.fileName\);\s*continue;/.test(src),
      false,
      "the unconditional skip survived",
    );
    // Regeneration must update the existing row, never insert a second one.
    assert.match(src, /generatedDocument\.update\(\{ where: \{ id: existing\.id \}/);
  });

  it("special-cases no filename", () => {
    for (const file of [
      "lib/engine/generated-artifact-staleness.ts",
      "lib/engine/artifact-quality-schema.ts",
    ]) {
      const src = readFileSync(file, "utf8");
      const body = src.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
      assert.equal(/Pharo|healthcare|Specialty Medical/i.test(body), false, `${file} names the benchmark`);
    }
  });
});
