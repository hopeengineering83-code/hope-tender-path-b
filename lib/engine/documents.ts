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
  if (["EXPERT", "PROJECT_EXPERIENCE"].includes(requirement.requirementType)) return 1;
  return Math.max(1, requirement.requiredQuantity ?? 1);
}

function packageFileName(requirement: RequirementDraft): string {
  if (requirement.exactFileName) return normalizeFileName(requirement.exactFileName);
  if (requirement.requirementType === "EXPERT") return normalizeFileName("Expert CV Package");
  if (requirement.requirementType === "PROJECT_EXPERIENCE") return normalizeFileName("Relevant Experience and Project References");
  return normalizeFileName(requirement.title);
}

function packageSummary(requirement: RequirementDraft): string {
  const qty = requirement.requiredQuantity && requirement.requiredQuantity > 1
    ? ` Tender quantity interpreted: ${requirement.requiredQuantity} item(s), consolidated into one response package instead of duplicate files.`
    : "";
  return `Planned tender-required output for ${requirement.title}: ${requirement.description}${qty}`;
}

function documentKey(document: DocumentPlanResult["documents"][number]): string {
  if (document.documentType === "EXPERT") return "EXPERT::CONSOLIDATED";
  if (document.documentType === "PROJECT_EXPERIENCE") return "PROJECT_EXPERIENCE::CONSOLIDATED";
  // Deduplicate by filename only — two requirements producing the same output
  // filename (regardless of document type) should collapse to one document.
  return document.exactFileName ?? document.name;
}

export function buildDocumentPlan(requirements: Array<{ id: string; requirement: RequirementDraft }>): DocumentPlanResult {
  const planned = requirements
    .filter(({ requirement }) => requiresGeneratedArtifact(requirement))
    .map(({ requirement }, requirementIndex) => {
      const quantity = plannedQuantity(requirement);
      const documents = [] as DocumentPlanResult["documents"];

      for (let i = 0; i < quantity; i += 1) {
        const suffix = quantity > 1 ? ` ${i + 1}` : "";
        const exactFileName = quantity === 1
          ? packageFileName(requirement)
          : normalizeFileName(`${requirement.title}${suffix}`);

        documents.push({
          name: exactFileName,
          documentType: docTypeForRequirement(requirement),
          exactFileName,
          exactOrder: requirement.exactOrder ?? requirementIndex + 1 + i,
          contentSummary: packageSummary(requirement),
        });
      }

      return documents;
    })
    .flat();

  const uniqueDocuments = planned.filter((document, index, arr) => {
    const key = documentKey(document);
    return arr.findIndex((item) => documentKey(item) === key) === index;
  });

  uniqueDocuments.sort((a, b) => {
    const ao = typeof a.exactOrder === "number" ? a.exactOrder : Number.MAX_SAFE_INTEGER;
    const bo = typeof b.exactOrder === "number" ? b.exactOrder : Number.MAX_SAFE_INTEGER;
    return ao - bo;
  });

  return { documents: uniqueDocuments };
}
