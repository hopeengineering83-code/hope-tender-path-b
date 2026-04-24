import type { DocumentPlanResult, RequirementDraft } from "./types";
import { normalizeSubmissionFileName, requiresGeneratedArtifact } from "./scope-policy";

function normalizeFileName(name: string): string {
  return normalizeSubmissionFileName(name.trim().replace(/\s+/g, " "));
}

function docTypeForRequirement(requirement: RequirementDraft): string {
  if (["FORM", "DECLARATION", "ANNEX", "SCHEDULE"].includes(requirement.requirementType)) return requirement.requirementType;
  if (requirement.requirementType === "EXPERT") return "EXPERT";
  if (requirement.requirementType === "PROJECT_EXPERIENCE") return "PROJECT_EXPERIENCE";
  if (requirement.requirementType === "COMPANY_PROFILE") return "COMPANY_PROFILE";
  if (requirement.requirementType === "METHODOLOGY") return "METHODOLOGY";
  if (/technical proposal|proposal|submission/i.test(`${requirement.title} ${requirement.description}`)) return "TECHNICAL_PROPOSAL";
  return requirement.requirementType || "SUPPORTING_DOCUMENT";
}

function plannedQuantity(requirement: RequirementDraft): number {
  if (["EXPERT", "PROJECT_EXPERIENCE"].includes(requirement.requirementType)) {
    return Math.max(0, requirement.requiredQuantity ?? 0);
  }
  return Math.max(1, requirement.requiredQuantity ?? 1);
}

export function buildDocumentPlan(requirements: Array<{ id: string; requirement: RequirementDraft }>): DocumentPlanResult {
  const planned = requirements
    .filter(({ requirement }) => requiresGeneratedArtifact(requirement))
    .map(({ requirement }, requirementIndex) => {
      const quantity = plannedQuantity(requirement);
      const documents = [] as DocumentPlanResult["documents"];

      for (let i = 0; i < quantity; i += 1) {
        const suffix = quantity > 1 ? ` ${i + 1}` : "";
        const exactFileName = requirement.exactFileName
          ? normalizeFileName(requirement.exactFileName)
          : normalizeFileName(`${requirement.title}${suffix}`);

        documents.push({
          name: exactFileName,
          documentType: docTypeForRequirement(requirement),
          exactFileName,
          exactOrder: requirement.exactOrder ?? requirementIndex + 1 + i,
          contentSummary: `Planned tender-required output for ${requirement.title}${suffix}: ${requirement.description}`,
        });
      }

      return documents;
    })
    .flat();

  const uniqueDocuments = planned.filter((document, index, arr) => {
    const key = `${document.documentType}::${document.exactFileName ?? document.name}::${document.exactOrder ?? ""}`;
    return arr.findIndex((item) => `${item.documentType}::${item.exactFileName ?? item.name}::${item.exactOrder ?? ""}` === key) === index;
  });

  uniqueDocuments.sort((a, b) => {
    const ao = typeof a.exactOrder === "number" ? a.exactOrder : Number.MAX_SAFE_INTEGER;
    const bo = typeof b.exactOrder === "number" ? b.exactOrder : Number.MAX_SAFE_INTEGER;
    return ao - bo;
  });

  return { documents: uniqueDocuments };
}
