import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { applyMainEngineBestAvailableSelection } from "../lib/engine/main-engine-selection-policy";
import type { MatchingResult, RequirementDraft } from "../lib/engine/types";

const requirements: RequirementDraft[] = [
  {
    title: "Professional Team Details",
    description: "Provide qualified key professionals for the assignment.",
    requirementType: "EXPERT",
    priority: "MANDATORY",
    requiredQuantity: 2,
  },
  {
    title: "Similar project experience",
    description: "Provide comparable completed project references.",
    requirementType: "PROJECT_EXPERIENCE",
    priority: "MANDATORY",
    requiredQuantity: 2,
  },
];

function fixture(): MatchingResult {
  return {
    expertMatches: [
      { expertId: "sv-expert-64", score: 0.64, rationale: "Grounded expert", evidenceSummary: "CV evidence", isSelected: false },
      { expertId: "sv-expert-42", score: 0.42, rationale: "Best available grounded expert", evidenceSummary: "CV evidence", isSelected: false },
      { expertId: "draft-expert-95", score: 0.95, rationale: "Draft must stay blocked", evidenceSummary: "Draft CV", isSelected: false },
    ],
    projectMatches: [
      { projectId: "sv-project-61", score: 0.61, rationale: "Grounded project", evidenceSummary: "Project evidence", isSelected: false },
      { projectId: "sv-project-38", score: 0.38, rationale: "Best available grounded project", evidenceSummary: "Project evidence", isSelected: false },
      { projectId: "draft-project-97", score: 0.97, rationale: "Draft must stay blocked", evidenceSummary: "Draft project", isSelected: false },
    ],
  };
}

describe("Main Engine SOURCE_VERIFIED authority", () => {
  it("treats durable SOURCE_VERIFIED evidence as equally eligible for safe-floor fallback", () => {
    const result = applyMainEngineBestAvailableSelection({
      requirements,
      matching: fixture(),
      expertTrust: new Map([
        ["sv-expert-64", "SOURCE_VERIFIED"],
        ["sv-expert-42", "SOURCE_VERIFIED"],
        ["draft-expert-95", "AI_DRAFT"],
      ]),
      projectTrust: new Map([
        ["sv-project-61", "SOURCE_VERIFIED"],
        ["sv-project-38", "SOURCE_VERIFIED"],
        ["draft-project-97", "REGEX_DRAFT"],
      ]),
    });

    assert.deepEqual(result.expertMatches.filter((item) => item.isSelected).map((item) => item.expertId), ["sv-expert-64"]);
    assert.deepEqual(result.projectMatches.filter((item) => item.isSelected).map((item) => item.projectId), ["sv-project-61"]);
    assert.equal(result.expertMatches.find((item) => item.expertId === "draft-expert-95")?.isSelected, false);
    assert.equal(result.projectMatches.find((item) => item.projectId === "draft-project-97")?.isSelected, false);
    assert.match(result.expertMatches.find((item) => item.isSelected)?.rationale ?? "", /source-verified evidence/i);
    assert.doesNotMatch(result.expertMatches.find((item) => item.isSelected)?.rationale ?? "", /reviewed evidence at/i);
  });

  it("preserves best-available fallback for SOURCE_VERIFIED evidence without inventing human review", () => {
    const low: MatchingResult = {
      expertMatches: [
        { expertId: "sv-expert-low", score: 0.35, rationale: "Low but best grounded expert", evidenceSummary: "CV", isSelected: false },
      ],
      projectMatches: [
        { projectId: "sv-project-low", score: 0.32, rationale: "Low but best grounded project", evidenceSummary: "Project", isSelected: false },
      ],
    };

    const result = applyMainEngineBestAvailableSelection({
      requirements,
      matching: low,
      expertTrust: new Map([["sv-expert-low", "SOURCE_VERIFIED"]]),
      projectTrust: new Map([["sv-project-low", "SOURCE_VERIFIED"]]),
    });

    assert.equal(result.expertMatches[0].isSelected, true);
    assert.equal(result.projectMatches[0].isSelected, true);
    assert.match(result.expertMatches[0].rationale, /BEST-AVAILABLE BELOW THRESHOLD/);
    assert.match(result.expertMatches[0].rationale, /source-verified evidence/i);
    assert.doesNotMatch(result.expertMatches[0].rationale, /human-reviewed|human promotion|reviewed evidence at/i);
  });

  it("continues to fail closed for draft evidence even when draft scores are higher", () => {
    const result = applyMainEngineBestAvailableSelection({
      requirements,
      matching: fixture(),
      expertTrust: new Map([
        ["sv-expert-64", "SOURCE_VERIFIED"],
        ["sv-expert-42", "SOURCE_VERIFIED"],
        ["draft-expert-95", "AI_DRAFT"],
      ]),
      projectTrust: new Map([
        ["sv-project-61", "SOURCE_VERIFIED"],
        ["sv-project-38", "SOURCE_VERIFIED"],
        ["draft-project-97", "REGEX_DRAFT"],
      ]),
    });

    assert.equal(result.expertMatches.find((item) => item.expertId === "draft-expert-95")?.isSelected, false);
    assert.equal(result.projectMatches.find((item) => item.projectId === "draft-project-97")?.isSelected, false);
  });
});