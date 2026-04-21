import type { DocumentPlanResult, RequirementDraft } from "./types";

export function buildDocumentPlan(requirements: Array<{ id: string; requirement: RequirementDraft }>): DocumentPlanResult {
  const documents = requirements
    .filter(({ requirement }) => {
      return Boolean(
        requirement.exactFileName ||
          ["FORM", "DECLARATION", "ANNEX", "SCHEDULE"].includes(requirement.requirementType) ||
          /proposal|submission|methodology|technical proposal/i.test(requirement.description),
      );
    })
    .map(({ requirement }, index) => ({
      name: requirement.exactFileName || `${requirement.title}.docx`,
      documentType: requirement.requirementType,
      exactFileName: requirement.exactFileName || null,
      exactOrder: requirement.exactOrder ?? index + 1,
      contentSummary: `Planned output for ${requirement.title}: ${requirement.description}`,
    }));

  return { documents };
}
