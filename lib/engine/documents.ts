import type { DocumentPlanResult, RequirementDraft } from "./types";

function normalizeFileName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function docTypeForRequirement(requirement: RequirementDraft): string {
  if (["FORM", "DECLARATION", "ANNEX", "SCHEDULE"].includes(requirement.requirementType)) {
    return requirement.requirementType;
  }
  if (requirement.requirementType === "EXPERT") return "EXPERT";
  if (requirement.requirementType === "PROJECT_EXPERIENCE") return "PROJECT_EXPERIENCE";
  if (requirement.requirementType === "COMPANY_PROFILE") return "COMPANY_PROFILE";
  if (requirement.requirementType === "METHODOLOGY") return "METHODOLOGY";
  if (/proposal|technical proposal|submission/i.test(`${requirement.title} ${requirement.description}`)) {
    return "TECHNICAL_PROPOSAL";
  }
  return requirement.requirementType || "SUPPORTING_DOCUMENT";
}

function shouldCreateDocument(requirement: RequirementDraft): boolean {
  return Boolean(
    requirement.exactFileName ||
      requirement.exactOrder ||
      ["FORM", "DECLARATION", "ANNEX", "SCHEDULE", "EXPERT", "PROJECT_EXPERIENCE", "COMPANY_PROFILE", "METHODOLOGY"].includes(requirement.requirementType) ||
      /proposal|submission|methodology|technical proposal|curriculum vitae|cv|project reference|company profile/i.test(
        `${requirement.title} ${requirement.description}`,
      ),
  );
}

export function buildDocumentPlan(requirements: Array<{ id: string; requirement: RequirementDraft }>): DocumentPlanResult {
  const planned = requirements
    .filter(({ requirement }) => shouldCreateDocument(requirement))
    .map(({ requirement }, index) => {
      const quantity = Math.max(1, requirement.requiredQuantity ?? 1);
      const documents = [] as DocumentPlanResult["documents"];

      for (let i = 0; i < quantity; i += 1) {
        const suffix = quantity > 1 ? ` ${i + 1}` : "";
        const baseFileName = requirement.exactFileName
          ? normalizeFileName(requirement.exactFileName)
          : `${normalizeFileName(requirement.title)}${suffix}.docx`;

        documents.push({
          name: baseFileName,
          documentType: docTypeForRequirement(requirement),
          exactFileName: requirement.exactFileName ? normalizeFileName(requirement.exactFileName) : baseFileName,
          exactOrder: requirement.exactOrder ?? index + 1 + i,
          contentSummary: `Planned output for ${requirement.title}${suffix}: ${requirement.description}`,
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
