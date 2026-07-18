import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { buildMatches } from "../lib/engine/matching";
import type { CompanyKnowledgeSnapshot, RequirementDraft } from "../lib/engine/types";

const matchingSource = readFileSync("lib/engine/matching.ts", "utf8");
const aiRematchRoute = readFileSync("app/api/tenders/[id]/ai-rematch/route.ts", "utf8");

function baseExpert(id: string, profile: string) {
  return {
    id,
    companyId: "company-1",
    fullName: `Expert ${id}`,
    title: "Logistics coordinator",
    email: null,
    phone: null,
    yearsExperience: 2,
    disciplines: JSON.stringify(["warehouse logistics"]),
    sectors: JSON.stringify(["transport logistics"]),
    certifications: JSON.stringify([]),
    profile,
    isActive: true,
    trustLevel: "REVIEWED",
    reviewedBy: "manager-1",
    reviewedAt: new Date("2025-01-01T00:00:00.000Z"),
    reviewNotes: null,
    sourceDocumentId: null,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    deletedAt: null,
    deletedBy: null,
  };
}

function baseProject(id: string, summary: string) {
  return {
    id,
    companyId: "company-1",
    name: `Project ${id}`,
    clientName: "Warehouse Client",
    country: "US",
    sector: "transport logistics",
    serviceAreas: JSON.stringify(["warehouse operations", "freight coordination"]),
    summary,
    contractValue: 10000,
    currency: "USD",
    startDate: new Date("2020-01-01T00:00:00.000Z"),
    endDate: new Date("2021-01-01T00:00:00.000Z"),
    trustLevel: "REVIEWED",
    reviewedBy: "manager-1",
    reviewedAt: new Date("2025-01-01T00:00:00.000Z"),
    reviewNotes: null,
    sourceDocumentId: null,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    deletedAt: null,
    deletedBy: null,
  };
}

describe("matching fail-closed selection", () => {
  it("does not retain below-threshold fallback promotion code", () => {
    assert.doesNotMatch(matchingSource, /Below-threshold fallback/);
    assert.doesNotMatch(matchingSource, /FALLBACK_MIN_SCORE/);
    assert.doesNotMatch(matchingSource, /MIN_FLOOR_SCORE/);
    assert.match(matchingSource, /Fail-closed selection: only candidates that meet the canonical/);
  });


  it("AI rematch cannot apply fallback selections when provider scoring is unavailable", () => {
    assert.match(aiRematchRoute, /const AI_SELECTION_THRESHOLD = 0\.75/);
    assert.match(aiRematchRoute, /const AI_CRITICAL_FLOOR_MINIMUM = 5/);
    assert.match(aiRematchRoute, /function isSelectionEligible\(assessment: CandidateAssessment\): boolean/);
    assert.match(aiRematchRoute, /assessment\.overallScore >= AI_SELECTION_THRESHOLD/);
    assert.match(aiRematchRoute, /criticalFloor\(assessment\) >= AI_CRITICAL_FLOOR_MINIMUM/);
    assert.match(aiRematchRoute, /assessment\.recommendSelection === true/);
    assert.match(aiRematchRoute, /const eligibleAssessments = assessments\.filter\(isSelectionEligible\)/);
    assert.match(aiRematchRoute, /AI_REMATCH_UNAVAILABLE_NO_SELECTION/);
    assert.doesNotMatch(aiRematchRoute, /AI_FALLBACK_APPLIED/);
    assert.doesNotMatch(aiRematchRoute, /AI_FALLBACK_PREVIEW/);
    assert.doesNotMatch(aiRematchRoute, /fallbackExpertIds/);
    assert.doesNotMatch(aiRematchRoute, /fallbackProjectIds/);
  });

  it("returns zero selected candidates when every candidate is below the threshold", () => {
    const requirements: RequirementDraft[] = [{
      title: "Hospital MEP and biomedical planning experts",
      description: "Bidder must provide healthcare facility architects, biomedical engineers, MEP hospital planners, infection-control design experience, and hospital project references.",
      requirementType: "EXPERT",
      priority: "MANDATORY",
      requiredQuantity: 3,
    }, {
      title: "Hospital facility project references",
      description: "Provide completed hospital design and healthcare facility references with biomedical planning and MEP scope.",
      requirementType: "PROJECT_EXPERIENCE",
      priority: "MANDATORY",
      requiredQuantity: 3,
    }];

    const knowledge: CompanyKnowledgeSnapshot = {
      companyId: "company-1",
      experts: [
        baseExpert("expert-1", "Warehouse inventory coordinator for freight depots and logistics yards."),
        baseExpert("expert-2", "Supply-chain analyst for trucking dispatch and storage operations."),
        baseExpert("expert-3", "Fleet routing officer for distribution centers."),
      ] as CompanyKnowledgeSnapshot["experts"],
      projects: [
        baseProject("project-1", "Warehouse racking and freight yard logistics project."),
        baseProject("project-2", "Truck depot scheduling and storage optimization assignment."),
        baseProject("project-3", "Distribution center inventory process improvement."),
      ] as CompanyKnowledgeSnapshot["projects"],
      documents: [],
      legalRecords: [] as CompanyKnowledgeSnapshot["legalRecords"],
      financialRecords: [] as CompanyKnowledgeSnapshot["financialRecords"],
      complianceRecords: [] as CompanyKnowledgeSnapshot["complianceRecords"],
    };

    const result = buildMatches(requirements, knowledge, "healthcare", "Hospital design consultancy");
    const selectedExperts = result.expertMatches.filter((m) => m.isSelected);
    const selectedProjects = result.projectMatches.filter((m) => m.isSelected);

    assert.equal(selectedExperts.length, 0);
    assert.equal(selectedProjects.length, 0);
    assert.ok(result.expertMatches.every((m) => !m.isSelected || m.score >= 0.75));
    assert.ok(result.projectMatches.every((m) => !m.isSelected || m.score >= 0.75));
  });
});
