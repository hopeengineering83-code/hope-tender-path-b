// G7 — score breakdown writer pure-function tests.
// Covers collapseToScalar and deterministicScoreBreakdown.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { collapseToScalar, deterministicScoreBreakdown } from "../lib/engine/generation/score-breakdown-writer";

describe("collapseToScalar", () => {
  it("returns 0 for an empty perspective map", () => {
    assert.equal(collapseToScalar({}), 0);
  });
  it("returns 0.5 for an even split of 0 and 100", () => {
    const v = collapseToScalar({ DISCIPLINE_FIT: 100, SCOPE_COVERAGE: 0 });
    assert.ok(Math.abs(v - 0.5) < 1e-6);
  });
  it("never returns greater than 1", () => {
    const v = collapseToScalar({ DISCIPLINE_FIT: 200 });
    assert.ok(v <= 1);
  });
  it("never returns less than 0", () => {
    const v = collapseToScalar({ DISCIPLINE_FIT: -50 });
    assert.ok(v >= 0);
  });
});

describe("deterministicScoreBreakdown", () => {
  it("emits all 12 dimensions", () => {
    const out = deterministicScoreBreakdown({
      candidateText: "Senior Architect, M.Sc., licensed PPA/1840, hospital design experience.",
      tenderText: "Architectural design for a healthcare facility.",
      evaluationText: "Mandatory: licensed architect.",
    });
    const dims = ["DISCIPLINE_FIT", "SCOPE_COVERAGE", "SENIORITY_OR_SCALE", "SECTOR_FIT", "ROLE_RECENCY", "EVIDENCE_QUALITY", "COMPLIANCE_CRITICALITY", "PORTFOLIO_CONTRIBUTION", "MANDATORY_ELIGIBILITY", "DELIVERY_RISK", "DIFFERENTIATION", "COMMERCIAL_VALUE"];
    for (const d of dims) {
      const v = (out as Record<string, number>)[d];
      assert.ok(typeof v === "number", `Expected number for ${d}, got ${typeof v}`);
      assert.ok(v >= 0 && v <= 100, `Expected 0..100 for ${d}, got ${v}`);
    }
  });

  it("rewards seniority signal", () => {
    const senior = deterministicScoreBreakdown({ candidateText: "senior lead engineer", tenderText: "" });
    const junior = deterministicScoreBreakdown({ candidateText: "junior trainee", tenderText: "" });
    assert.ok((senior.SENIORITY_OR_SCALE ?? 0) > (junior.SENIORITY_OR_SCALE ?? 0));
  });

  it("rewards eligibility signal when license appears", () => {
    const lic = deterministicScoreBreakdown({ candidateText: "licensed PPA/1840", tenderText: "" });
    const noLic = deterministicScoreBreakdown({ candidateText: "no credentials listed", tenderText: "" });
    assert.ok((lic.MANDATORY_ELIGIBILITY ?? 0) > (noLic.MANDATORY_ELIGIBILITY ?? 0));
  });
});
