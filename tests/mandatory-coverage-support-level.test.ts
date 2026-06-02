// Part 10 — formal support-level model + mandatory-coverage actions.
//
// The support-level helpers are pure and unit-tested here. The coverage
// actions reuse the existing ComplianceGap PUT endpoint (which already
// persists isResolved / resolvedNote / mitigationPlan and is honoured by
// validation + readiness), so the compliance dashboard wiring is asserted at
// the source level.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeSupportLevel,
  isStrongSupportLevel,
  computeEvidenceCoverage,
  type RequirementLikeForEvidence,
} from "../lib/engine/requirement-evidence-profile";

describe("normalizeSupportLevel", () => {
  it("maps known spellings onto the formal enum", () => {
    assert.equal(normalizeSupportLevel("FULL"), "FULL");
    assert.equal(normalizeSupportLevel("substantial"), "SUBSTANTIAL");
    assert.equal(normalizeSupportLevel("Partial"), "PARTIAL");
    assert.equal(normalizeSupportLevel("NOT_COVERED"), "NOT_COVERED");
    assert.equal(normalizeSupportLevel("NONE"), "NONE");
  });
  it("recognises not-applicable spellings", () => {
    assert.equal(normalizeSupportLevel("NOT_APPLICABLE"), "NOT_APPLICABLE");
    assert.equal(normalizeSupportLevel("N/A"), "NOT_APPLICABLE");
    assert.equal(normalizeSupportLevel("na"), "NOT_APPLICABLE");
  });
  it("defaults empty to NONE and unknown non-empty to PARTIAL", () => {
    assert.equal(normalizeSupportLevel(null), "NONE");
    assert.equal(normalizeSupportLevel(""), "NONE");
    assert.equal(normalizeSupportLevel("weird"), "PARTIAL");
  });
});

describe("isStrongSupportLevel", () => {
  it("only FULL / SUBSTANTIAL are strong", () => {
    assert.equal(isStrongSupportLevel("FULL"), true);
    assert.equal(isStrongSupportLevel("SUBSTANTIAL"), true);
    assert.equal(isStrongSupportLevel("PARTIAL"), false);
    assert.equal(isStrongSupportLevel("NOT_APPLICABLE"), false);
    assert.equal(isStrongSupportLevel("NONE"), false);
  });
});

describe("computeEvidenceCoverage still treats FULL/SUBSTANTIAL as strong (regression)", () => {
  const reqs: RequirementLikeForEvidence[] = [
    { id: "r1", title: "Audited financials", description: "", requirementType: "ELIGIBILITY", priority: "MANDATORY", complianceMatrixRows: [{ id: "m1", supportLevel: "FULL" }] },
    { id: "r2", title: "Methodology", description: "", requirementType: "METHODOLOGY", priority: "MANDATORY", complianceMatrixRows: [{ id: "m2", supportLevel: "PARTIAL" }] },
    { id: "r3", title: "Uncovered", description: "", requirementType: "TECHNICAL", priority: "MANDATORY", complianceMatrixRows: [] },
  ];
  it("counts the FULL row as strong, PARTIAL as any-only, empty as neither", () => {
    const cov = computeEvidenceCoverage(reqs);
    assert.equal(cov.requirementsWithStrongEvidence, 1);
    assert.equal(cov.requirementsWithLinkedEvidence, 2);
    assert.equal(cov.totalRequirements, 3);
  });
});

describe("compliance dashboard exposes mandatory-coverage actions (Part 10)", () => {
  const source = readFileSync("app/dashboard/compliance/compliance-dashboard.tsx", "utf8");

  it("offers mark-covered, mark-not-applicable, mitigation and JV/subcontractor actions", () => {
    assert.match(source, /Mark covered with evidence/);
    assert.match(source, /Mark not applicable/);
    assert.match(source, /Add mitigation/);
    assert.match(source, /JV \/ subcontractor/i);
  });

  it("records a not-applicable decision with an audit note", () => {
    assert.match(source, /NOT_APPLICABLE:/);
  });

  it("persists mitigation via the existing gap PUT (mitigationPlan)", () => {
    assert.match(source, /mitigationPlan/);
  });
});

describe("gap PUT endpoint accepts the coverage fields", () => {
  const source = readFileSync("app/api/tenders/[id]/gaps/[gapId]/route.ts", "utf8");
  it("accepts isResolved, resolvedNote, and mitigationPlan", () => {
    assert.match(source, /isResolved/);
    assert.match(source, /resolvedNote/);
    assert.match(source, /mitigationPlan/);
  });
});
