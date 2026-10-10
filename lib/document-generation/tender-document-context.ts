/**
 * Tender Document Generation Context
 *
 * Builds the context object that the document composer uses to generate
 * tender-type-specific, HAEC service-stream-aware documents.
 *
 * This module CONSUMES facts from existing services but does NOT reimplement
 * the canonical fact resolver or final-package readiness model.
 */

import type { Tender as PrismaTender } from "@prisma/client";
import { classifyTender, type TenderType, type CompanyService } from "../engine/tender-classification";
import { readFinancialProposalRequirement, statesDocumentObligation } from "../engine/source-driven-tender-text-parser";

// ─── Types ──────────────────────────────────────────────────────────────────

export type SelectedExpertForDocument = {
  id: string;
  fullName: string;
  title: string | null;
  disciplines: string[];
  yearsExperience: number | null;
  trustLevel: string;
  isSelected: boolean;
};

export type SelectedProjectForDocument = {
  id: string;
  name: string;
  clientName: string | null;
  sector: string | null;
  serviceAreas: string[];
  summary: string | null;
  contractValue: number | null;
  currency: string | null;
  startDate: Date | null;
  endDate: Date | null;
  trustLevel: string;
  isSelected: boolean;
};

export type SelectedLegalDocumentForDocument = {
  id: string;
  title: string;
  recordType: string;
  status: string;
  issueDate: Date | null;
  expiryDate: Date | null;
  referenceNumber: string | null;
};

export type SelectedCompanyAssetForDocument = {
  id: string;
  fileName: string;
  assetType: string | null;
  description: string | null;
};

export type CompanyProfileForDocument = {
  name: string;
  description: string | null;
  country: string | null;
  website: string | null;
  serviceLines: string[];
  establishedYear: number | null;
};

export type TenderDocumentGenerationContext = {
  tenderId: string;
  tenderType: TenderType;
  serviceStreams: CompanyService[];
  projectTitle: string | null;
  clientName: string | null;
  submissionMethod: string | null;
  deadline: string | null;
  financialProposalRequired: boolean;

  scopeOfServices: string[];
  deliverables: string[];
  evaluationCriteria: string[];
  mandatoryRequirements: string[];
  requiredDocuments: string[];

  selectedExperts: SelectedExpertForDocument[];
  selectedProjects: SelectedProjectForDocument[];
  selectedLegalDocuments: SelectedLegalDocumentForDocument[];
  selectedCompanyAssets: SelectedCompanyAssetForDocument[];

  companyProfile: CompanyProfileForDocument;
  warnings: string[];
};

// ─── Context builder ────────────────────────────────────────────────────────

/**
 * Build the document generation context from a tender and its related data.
 *
 * This function is PURE — it does not write to the database. It reads from
 * the tender object and related arrays and produces a typed context.
 */
export function buildTenderDocumentContext(
  tender: {
    id: string;
    title: string | null;
    clientName: string | null;
    reference: string | null;
    submissionMethod: string | null;
    deadline: Date | null;
    description: string | null;
    intakeSummary: string | null;
    category: string | null;
    country: string | null;
  },
  files: Array<{ extractedText: string | null }>,
  requirements: Array<{
    title: string;
    description: string;
    priority: string;
    requirementType: string;
    sectionReference: string | null;
  }>,
  experts: SelectedExpertForDocument[],
  projects: SelectedProjectForDocument[],
  legalDocs: SelectedLegalDocumentForDocument[],
  companyAssets: SelectedCompanyAssetForDocument[],
  company: CompanyProfileForDocument,
): TenderDocumentGenerationContext {
  const combinedText = files.map((f) => f.extractedText ?? "").join("\n\n");
  const classification = classifyTender(combinedText);

  // Detect financial proposal requirement
  const financialProposalRequired = detectFinancialProposalRequired(combinedText);

  // Extract scope of services from requirements
  const scopeOfServices = requirements
    .filter((r) => /scope|services|deliverable/i.test(r.title + " " + r.description))
    .map((r) => r.title);

  // Extract deliverables
  const deliverables = requirements
    .filter((r) => /deliverable|output|report/i.test(r.title + " " + r.description))
    .map((r) => r.title);

  // Extract evaluation criteria
  const evaluationCriteria = requirements
    .filter((r) => /evaluation|criteria|scoring|weight/i.test(r.title + " " + r.description))
    .map((r) => r.title);

  // Mandatory requirements
  const mandatoryRequirements = requirements
    .filter((r) => r.priority?.toUpperCase() === "MANDATORY")
    .map((r) => r.title);

  // Required documents
  // A required-document requirement is one that STATES a document obligation.
  // The keyword test alone silently dropped every instrument a tender names
  // itself — "Power of Attorney", "Declaration of Independent Bid
  // Determination" — because none of those words appear in them. It is kept as
  // a cheap first signal; the obligation reader catches the rest.
  const requiredDocuments = requirements
    .filter(
      (r) =>
        /document|annex|attachment|form/i.test(r.title + " " + r.description)
        || statesDocumentObligation(`${r.title}. ${r.description}`),
    )
    .map((r) => r.title);

  const warnings: string[] = [];
  if (experts.filter((e) => e.isSelected).length === 0) {
    warnings.push("No experts selected — team section will show controlled gap text.");
  }
  if (projects.filter((p) => p.isSelected).length === 0) {
    warnings.push("No projects selected — experience section will show controlled gap text.");
  }
  if (!financialProposalRequired) {
    warnings.push("Financial proposal not required — financial documents will be excluded.");
  }

  return {
    tenderId: tender.id,
    tenderType: classification.tenderType,
    serviceStreams: classification.companyServices,
    projectTitle: tender.title,
    clientName: tender.clientName,
    submissionMethod: tender.submissionMethod,
    deadline: tender.deadline ? new Date(tender.deadline).toISOString() : null,
    financialProposalRequired,
    scopeOfServices,
    deliverables,
    evaluationCriteria,
    mandatoryRequirements,
    requiredDocuments,
    selectedExperts: experts.filter((e) => e.isSelected),
    selectedProjects: projects.filter((p) => p.isSelected),
    selectedLegalDocuments: legalDocs,
    selectedCompanyAssets: companyAssets,
    companyProfile: company,
    warnings,
  };
}

/**
 * Is a financial submission required?
 *
 * This used to be a second, independent policy: its own denial vocabulary and a
 * `return true` at the bottom, so a source that said nothing about money
 * produced a required Price Schedule. It disagreed with the canonical reader on
 * real wording in both directions, and the two were consulted by different
 * parts of the same pipeline.
 *
 * There is one reader now. This delegates to it and keeps its boolean shape for
 * existing callers: UNKNOWN is not an obligation, so only an established
 * requirement returns true. Callers that must tell "the source said no" apart
 * from "the source said nothing" read readFinancialProposalRequirement()
 * directly rather than re-deriving it here.
 */
export function detectFinancialProposalRequired(text: string): boolean {
  return readFinancialProposalRequirement(text) === true;
}
