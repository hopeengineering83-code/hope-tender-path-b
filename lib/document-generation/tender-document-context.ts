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
  const requiredDocuments = requirements
    .filter((r) => /document|annex|attachment|form/i.test(r.title + " " + r.description))
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
 * Detect whether a financial proposal is required based on tender text.
 */
function detectFinancialProposalRequired(text: string): boolean {
  const sample = text.slice(0, 100_000).toLowerCase();
  // Explicit "not required" signals
  if (/financial\s+proposal\s+not\s+required/i.test(sample)) return false;
  if (/do\s+not\s+(?:generate|include|submit)\s+a?\s*financial\s+proposal/i.test(sample)) return false;
  if (/technical\s+proposal\s+only/i.test(sample)) return false;
  if (/no\s+financial\s+(?:proposal|offer|bid)/i.test(sample)) return false;
  // Two-envelope → financial IS required (separately)
  if (/two\s+envelope|separate\s+envelope/i.test(sample)) return true;
  // Default: financial is required for RFP/RFQ
  return true;
}
