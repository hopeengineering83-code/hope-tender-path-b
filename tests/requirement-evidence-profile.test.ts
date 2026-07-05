// Regression tests for Gap 14 — requirement evidence profile + coverage.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildRequirementEvidenceProfile,
  computeEvidenceCoverage,
  type RequirementLikeForEvidence,
} from "../lib/engine/requirement-evidence-profile";

function req(overrides: Partial<RequirementLikeForEvidence>): RequirementLikeForEvidence {
  return {
    id: "r1",
    title: "Sample requirement",
    description: "Sample description.",
    requirementType: "TECHNICAL",
    priority: "MANDATORY",
    ...overrides,
  };
}

describe("requirement-evidence-profile — evidence-kind inference", () => {
  it("requirementType=EXPERT maps to EXPERT_CV", () => {
    const p = buildRequirementEvidenceProfile(req({ requirementType: "EXPERT", title: "Team Leader" }));
    assert.ok(p.evidenceNeeded.includes("EXPERT_CV"));
  });

  it("requirementType=PROJECT_EXPERIENCE maps to PROJECT_REFERENCE", () => {
    const p = buildRequirementEvidenceProfile(req({ requirementType: "PROJECT_EXPERIENCE", title: "5 similar projects" }));
    assert.ok(p.evidenceNeeded.includes("PROJECT_REFERENCE"));
  });

  it("requirementType=FORM maps to FORM_TEMPLATE", () => {
    const p = buildRequirementEvidenceProfile(req({ requirementType: "FORM", title: "Form 1: Bidder Info" }));
    assert.ok(p.evidenceNeeded.includes("FORM_TEMPLATE"));
  });

  it("text-based inference picks up LEGAL_REGISTRATION and TAX_CERTIFICATE", () => {
    const p = buildRequirementEvidenceProfile(req({
      requirementType: "ELIGIBILITY",
      title: "Eligibility",
      description: "Bidder must provide a valid business license and tax clearance certificate.",
    }));
    assert.ok(p.evidenceNeeded.includes("LEGAL_REGISTRATION"));
    assert.ok(p.evidenceNeeded.includes("TAX_CERTIFICATE"));
  });

  it("text-based inference picks up FINANCIAL_STATEMENT for audited reports", () => {
    const p = buildRequirementEvidenceProfile(req({
      requirementType: "FINANCIAL",
      title: "Audited financial statements for the last 3 fiscal years",
    }));
    assert.ok(p.evidenceNeeded.includes("FINANCIAL_STATEMENT"));
  });

  it("no rule matches → GENERAL", () => {
    const p = buildRequirementEvidenceProfile(req({
      requirementType: "OTHER",
      title: "Miscellaneous note about the project background.",
    }));
    assert.deepEqual(p.evidenceNeeded, ["GENERAL"]);
  });
});

describe("requirement-evidence-profile — strong link detection", () => {
  it("hasStrongEvidence is true when any complianceMatrixRow is FULL", () => {
    const p = buildRequirementEvidenceProfile(req({
      complianceMatrixRows: [
        { id: "cm1", supportLevel: "PARTIAL" },
        { id: "cm2", supportLevel: "FULL" },
      ],
    }));
    assert.equal(p.hasStrongEvidence, true);
    assert.deepEqual(p.linkedEvidenceIds, ["cm1", "cm2"]);
  });

  it("hasStrongEvidence is true when any complianceMatrixRow is SUBSTANTIAL", () => {
    const p = buildRequirementEvidenceProfile(req({
      complianceMatrixRows: [{ id: "cm1", supportLevel: "SUBSTANTIAL" }],
    }));
    assert.equal(p.hasStrongEvidence, true);
  });

  it("hasStrongEvidence is false when only PARTIAL links exist", () => {
    const p = buildRequirementEvidenceProfile(req({
      complianceMatrixRows: [
        { id: "cm1", supportLevel: "PARTIAL" },
        { id: "cm2", supportLevel: "PARTIAL" },
      ],
    }));
    assert.equal(p.hasStrongEvidence, false);
    assert.equal(p.linkedEvidenceIds.length, 2);
  });

  it("hasStrongEvidence is false when no links at all", () => {
    const p = buildRequirementEvidenceProfile(req({}));
    assert.equal(p.hasStrongEvidence, false);
    assert.deepEqual(p.linkedEvidenceIds, []);
  });
});

describe("requirement-evidence-profile — coverage percent", () => {
  it("strongCoveragePercent only counts FULL/SUBSTANTIAL links", () => {
    const report = computeEvidenceCoverage([
      req({ id: "r1", complianceMatrixRows: [{ id: "cm1", supportLevel: "FULL" }] }),
      req({ id: "r2", complianceMatrixRows: [{ id: "cm2", supportLevel: "PARTIAL" }] }),
      req({ id: "r3", complianceMatrixRows: [{ id: "cm3", supportLevel: "SUBSTANTIAL" }] }),
      req({ id: "r4" }),
    ]);
    assert.equal(report.totalRequirements, 4);
    assert.equal(report.requirementsWithLinkedEvidence, 3);  // r1, r2, r3 have links
    assert.equal(report.requirementsWithStrongEvidence, 2);  // r1, r3 are strong
    assert.equal(report.strongCoveragePercent, 50);          // 2/4 = 50%
    assert.equal(report.anyCoveragePercent, 75);             // 3/4 = 75%
  });

  it("0% coverage when no requirements have links (the screenshot scenario)", () => {
    const report = computeEvidenceCoverage([
      req({ id: "r1" }),
      req({ id: "r2" }),
      req({ id: "r3" }),
    ]);
    assert.equal(report.strongCoveragePercent, 0);
    assert.equal(report.anyCoveragePercent, 0);
  });

  it("empty requirement list returns 0 totals (no NaN)", () => {
    const report = computeEvidenceCoverage([]);
    assert.equal(report.totalRequirements, 0);
    assert.equal(report.strongCoveragePercent, 0);
    assert.equal(report.anyCoveragePercent, 0);
  });

  it("profiles array preserves the input ordering and metadata", () => {
    const report = computeEvidenceCoverage([
      req({ id: "r1", title: "First", sourceExactQuote: "verbatim quote", sourcePageNumber: 7, sectionReference: "Section A.2" }),
      req({ id: "r2", title: "Second" }),
    ]);
    assert.equal(report.profiles.length, 2);
    assert.equal(report.profiles[0].requirementId, "r1");
    assert.equal(report.profiles[0].sourceQuote, "verbatim quote");
    assert.equal(report.profiles[0].sourcePage, 7);
    assert.equal(report.profiles[0].sectionReference, "Section A.2");
  });
});
