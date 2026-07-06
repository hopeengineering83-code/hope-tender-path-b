/**
 * Requirement Categories
 *
 * Normalizes tender requirements into 18 standard categories and classifies
 * them as mandatory, critical, or advisory.
 *
 * Used by:
 * - Requirement extraction (to categorize AI-extracted requirements)
 * - Proposal generation (to link proposal sections to requirements)
 * - Company evidence matching (to match company capabilities to requirements)
 * - BuildPlan (to ensure all mandatory categories are covered)
 */

import { classifyRequirement, classifyRequirementMandatory, type EvidenceCategory } from "./tender-classification";

export type RequirementCategory = EvidenceCategory;

export type RequirementClassification = {
  category: RequirementCategory;
  mandatory: "mandatory" | "critical" | "advisory";
  linkedProposalSection: string | null;
  linkedCompanyEvidence: string | null;
  unresolvedReason: string | null;
};

/**
 * Map a requirement category to its corresponding proposal section.
 */
const CATEGORY_TO_PROPOSAL_SECTION: Record<RequirementCategory, string | null> = {
  "eligibility": "Section A: Eligibility Statement",
  "qualifications": "Section B: Company Qualifications",
  "experience": "Section B: Relevant Experience",
  "personnel": "Section C: Key Personnel & CVs",
  "methodology": "Section C: Technical Methodology",
  "deliverables": "Section C: Deliverables",
  "required-documents": "Annex: Required Documents Checklist",
  "evaluation-criteria": null, // Not a proposal section — evaluation is by the client
  "financial-requirements": "Section D: Financial Proposal",
  "bid-security": "Annex: Bid Security",
  "submission-rules": null, // Not a proposal section — compliance check
  "annexes": "Annex: Required Annexes",
  "contracts": null, // Not a proposal section — contract review
  "compliance": "Annex: Compliance Certificates",
  "formatting": null, // Not a proposal section — formatting check
  "unknown": null,
};

/**
 * Classify a requirement into category + mandatory level + proposal section link.
 */
export function classifyTenderRequirement(
  requirementText: string,
): RequirementClassification {
  const category = classifyRequirement(requirementText);
  const mandatory = classifyRequirementMandatory(requirementText);
  const linkedProposalSection = CATEGORY_TO_PROPOSAL_SECTION[category] ?? null;

  return {
    category,
    mandatory,
    linkedProposalSection,
    linkedCompanyEvidence: null, // Filled by matching engine
    unresolvedReason: null, // Filled when matching fails
  };
}

/**
 * Determine the unresolved reason for a requirement.
 */
export function determineUnresolvedReason(
  classification: RequirementClassification,
  hasCompanyEvidence: boolean,
): string | null {
  if (classification.mandatory === "advisory") return null; // Advisory = not blocking
  if (!hasCompanyEvidence) {
    return "company-evidence-missing";
  }
  return null;
}

/**
 * Get all mandatory requirement categories that must be covered.
 */
export function getMandatoryCategories(): RequirementCategory[] {
  return [
    "eligibility",
    "qualifications",
    "experience",
    "personnel",
    "methodology",
    "deliverables",
    "required-documents",
    "submission-rules",
    "evaluation-criteria",
    "financial-requirements",
  ];
}
