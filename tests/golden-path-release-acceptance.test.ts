import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SANITIZED_HEALTHCARE_ACCEPTANCE_FIXTURE as fixture } from "../lib/engine/pharo-acceptance-fixture";
import { buildCriterionCoverage, allCriteriaCovered } from "../lib/engine/criterion-coverage-model";
import { scoreClientQuality, CLIENT_QUALITY_DIMENSIONS } from "../lib/engine/client-quality-scoring";

describe("sanitized populated golden path", () => {
  it("contains reviewed experts, projects, brand asset, and source files before analysis", () => {
    assert.ok(fixture.experts.length >= 2 && fixture.experts.every((row) => row.reviewed));
    assert.ok(fixture.projects.length >= 1 && fixture.projects.every((row) => row.reviewed));
    assert.match(fixture.company.brandAsset, /\.svg$/); assert.ok(fixture.tender.sourceFiles.length > 0);
  });
  it("uses synthetic identifiers and no real customer data", () => {
    assert.match(fixture.company.name, /^SYNTH/); assert.match(fixture.tender.id, /^SYNTH/);
    assert.ok(fixture.experts.every((row) => row.id.startsWith("SYNTH-")));
  });
  it("requires grounded coverage for every healthcare criterion", () => {
    const evidence = Object.fromEntries(fixture.tender.mandatoryCriteria.map((criterion) => [criterion, [`SYNTH-EV-${criterion}`]]));
    assert.equal(allCriteriaCovered(buildCriterionCoverage(fixture.tender.mandatoryCriteria, evidence)), true);
  });
  it("reaches 100 only when all nine quality dimensions pass and no blocker remains", () => {
    const values = Object.fromEntries(CLIENT_QUALITY_DIMENSIONS.map((key) => [key, 100]));
    assert.equal(scoreClientQuality(values).score, 100);
    assert.equal(scoreClientQuality(values, ["BUILD_PLAN_REVIEW_REQUIRED"]).score, 99);
  });
});
