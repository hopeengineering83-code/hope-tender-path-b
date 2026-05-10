import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { applyMainEngineBestAvailableSelection } from "../lib/engine/main-engine-selection-policy";
import { buildTenderResponseBlueprint } from "../lib/engine/tender-response-blueprint";
import type { MatchingResult, RequirementDraft } from "../lib/engine/types";

function expertRequirement(quantity = 2): RequirementDraft {
  return {
    title: "Key professional staff",
    description: "Provide qualified reviewed experts for architectural design and construction supervision.",
    requirementType: "EXPERT",
    priority: "MANDATORY",
    requiredQuantity: quantity,
  };
}

function projectRequirement(quantity = 2): RequirementDraft {
  return {
    title: "Comparable project experience",
    description: "Provide reviewed similar project references for hospital design, supervision, contract administration and handover.",
    requirementType: "PROJECT_EXPERIENCE",
    priority: "MANDATORY",
    requiredQuantity: quantity,
  };
}

function matchingFixture(): MatchingResult {
  return {
    expertMatches: [
      { expertId: "expert-reviewed-78", score: 0.78, rationale: "Good reviewed architect below old 90 threshold", evidenceSummary: "Reviewed architect", isSelected: false },
      { expertId: "expert-reviewed-64", score: 0.64, rationale: "Second reviewed supervisor below old 90 threshold", evidenceSummary: "Reviewed supervisor", isSelected: false },
      { expertId: "expert-draft-92", score: 0.92, rationale: "High draft score must not be promoted", evidenceSummary: "Draft CV", isSelected: false },
    ],
    projectMatches: [
      { projectId: "project-reviewed-72", score: 0.72, rationale: "Reviewed hospital project below old 90 threshold", evidenceSummary: "Reviewed hospital design project", isSelected: false },
      { projectId: "project-reviewed-61", score: 0.61, rationale: "Reviewed supervision project below old 90 threshold", evidenceSummary: "Reviewed supervision project", isSelected: false },
      { projectId: "project-draft-95", score: 0.95, rationale: "High draft score must not be promoted", evidenceSummary: "Draft project", isSelected: false },
    ],
  };
}

describe("main engine best-available selection regression", () => {
  it("selects reviewed best-available expert and project evidence below the old 90 percent threshold", () => {
    const result = applyMainEngineBestAvailableSelection({
      requirements: [expertRequirement(2), projectRequirement(2)],
      matching: matchingFixture(),
      expertTrust: new Map([
        ["expert-reviewed-78", "REVIEWED"],
        ["expert-reviewed-64", "REVIEWED"],
        ["expert-draft-92", "AI_DRAFT"],
      ]),
      projectTrust: new Map([
        ["project-reviewed-72", "REVIEWED"],
        ["project-reviewed-61", "REVIEWED"],
        ["project-draft-95", "REGEX_DRAFT"],
      ]),
    });

    assert.deepEqual(
      result.expertMatches.filter((m) => m.isSelected).map((m) => m.expertId),
      ["expert-reviewed-78", "expert-reviewed-64"],
    );
    assert.deepEqual(
      result.projectMatches.filter((m) => m.isSelected).map((m) => m.projectId),
      ["project-reviewed-72", "project-reviewed-61"],
    );
    assert.equal(result.expertMatches.find((m) => m.expertId === "expert-draft-92")?.isSelected, false);
    assert.equal(result.projectMatches.find((m) => m.projectId === "project-draft-95")?.isSelected, false);
  });

  it("does not override an existing manual/engine selection", () => {
    const existing = matchingFixture();
    existing.expertMatches[0].isSelected = true;
    existing.projectMatches[0].isSelected = true;

    const result = applyMainEngineBestAvailableSelection({
      requirements: [expertRequirement(3), projectRequirement(3)],
      matching: existing,
      expertTrust: new Map([
        ["expert-reviewed-78", "REVIEWED"],
        ["expert-reviewed-64", "REVIEWED"],
        ["expert-draft-92", "AI_DRAFT"],
      ]),
      projectTrust: new Map([
        ["project-reviewed-72", "REVIEWED"],
        ["project-reviewed-61", "REVIEWED"],
        ["project-draft-95", "AI_DRAFT"],
      ]),
    });

    assert.deepEqual(result.expertMatches.filter((m) => m.isSelected).map((m) => m.expertId), ["expert-reviewed-78"]);
    assert.deepEqual(result.projectMatches.filter((m) => m.isSelected).map((m) => m.projectId), ["project-reviewed-72"]);
  });
});

describe("tender response blueprint regression", () => {
  it("maps a hospital tender requirement to hospital evidence rather than warehouse evidence", () => {
    const blueprint = buildTenderResponseBlueprint({
      tenderTitle: "RFP for Hospital Design, Interior Design, Supervision and Contract Administration Services",
      clientName: "Health Client",
      requirements: [
        "Provide similar hospital or healthcare facility design, interior design, construction supervision and contract administration experience.",
      ],
      expertLines: [
        "Reviewed expert: Architect with hospital planning, interior design and healthcare facility supervision experience.",
      ],
      projectLines: [
        "Reviewed project: Warehouse logistics facility master plan and storage yard design for industrial client.",
        "Reviewed project: Hospital and specialty clinic design, interior design, construction supervision and handover for healthcare client.",
      ],
      companyEvidenceLines: [],
      projectEvidenceLines: [],
      complianceLines: [],
      differentiators: [],
    });

    assert.equal(blueprint.length, 1);
    assert.match(blueprint[0].evidenceLine, /hospital|healthcare|clinic/i);
    assert.doesNotMatch(blueprint[0].evidenceLine, /warehouse|logistics|storage/i);
    assert.notEqual(blueprint[0].evidenceSupport, "NEEDS_CONFIRMATION");
  });
});
