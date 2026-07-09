/**
 * Tender Section Planner
 *
 * Selects which document sections to generate based on tender type,
 * financial proposal requirement, and two-envelope structure.
 */

import type { TenderType } from "../engine/tender-classification";
import type { TenderDocumentGenerationContext } from "./tender-document-context";

export type DocumentSection = {
  id: string;
  title: string;
  required: boolean;
  envelope: "TECHNICAL" | "FINANCIAL" | "ADMIN";
  tenderTypes: TenderType[] | "ALL";
  condition?: (ctx: TenderDocumentGenerationContext) => boolean;
};

export type DocumentPlan = {
  documents: Array<{
    type: string;
    title: string;
    sections: DocumentSection[];
    envelope: "TECHNICAL" | "FINANCIAL" | "ADMIN";
    skipReason?: string;
  }>;
  skippedDocuments: Array<{ type: string; reason: string }>;
};

// ─── Section definitions ────────────────────────────────────────────────────

const COVER_LETTER: DocumentSection = {
  id: "cover-letter", title: "Cover Letter", required: true, envelope: "ADMIN", tenderTypes: "ALL",
};

const COMPANY_PROFILE: DocumentSection = {
  id: "company-profile", title: "Company Profile", required: true, envelope: "ADMIN", tenderTypes: "ALL",
};

const UNDERSTANDING: DocumentSection = {
  id: "understanding", title: "Understanding of the Assignment", required: true, envelope: "TECHNICAL", tenderTypes: "ALL",
};

const TECHNICAL_APPROACH: DocumentSection = {
  id: "technical-approach", title: "Technical Approach and Methodology", required: true, envelope: "TECHNICAL",
  tenderTypes: ["RFP", "ITB", "RFT", "consultancy", "works", "framework"],
};

const WORK_PLAN: DocumentSection = {
  id: "work-plan", title: "Work Plan", required: true, envelope: "TECHNICAL",
  tenderTypes: ["RFP", "ITB", "RFT", "consultancy", "works", "framework"],
};

const TEAM_COMPOSITION: DocumentSection = {
  id: "team-composition", title: "Team Composition", required: true, envelope: "TECHNICAL",
  tenderTypes: ["RFP", "ITB", "consultancy", "framework"],
  // Always include — shows controlled gap text when no experts selected
};

const EXPERT_ROLE_MATRIX: DocumentSection = {
  id: "expert-role-matrix", title: "Expert Role Matrix", required: false, envelope: "TECHNICAL",
  tenderTypes: ["RFP", "consultancy"],
  condition: (ctx) => ctx.selectedExperts.length > 0,
};

const CV_SUMMARY: DocumentSection = {
  id: "cv-summary", title: "CV Summary", required: false, envelope: "TECHNICAL",
  tenderTypes: ["RFP", "consultancy"],
  condition: (ctx) => ctx.selectedExperts.length > 0,
};

const SIMILAR_PROJECTS: DocumentSection = {
  id: "similar-projects", title: "Similar Project References", required: true, envelope: "TECHNICAL",
  tenderTypes: "ALL",
  condition: (ctx) => ctx.selectedProjects.length > 0,
};

const COMPLIANCE_MATRIX: DocumentSection = {
  id: "compliance-matrix", title: "Compliance Matrix", required: true, envelope: "TECHNICAL",
  tenderTypes: ["RFP", "ITB", "RFT", "consultancy", "works", "framework"],
  condition: (ctx) => ctx.mandatoryRequirements.length > 0,
};

const LEGAL_COMPLIANCE: DocumentSection = {
  id: "legal-compliance", title: "Legal / Compliance Documents", required: false, envelope: "ADMIN",
  tenderTypes: "ALL",
  condition: (ctx) => ctx.selectedLegalDocuments.length > 0,
};

const SUBMISSION_CHECKLIST: DocumentSection = {
  id: "submission-checklist", title: "Submission Checklist", required: true, envelope: "ADMIN", tenderTypes: "ALL",
};

const ANNEX_LIST: DocumentSection = {
  id: "annex-list", title: "Annex List", required: false, envelope: "ADMIN",
  tenderTypes: "ALL",
  condition: (ctx) => ctx.requiredDocuments.length > 0,
};

const EOI_DOCUMENT: DocumentSection = {
  id: "eoi-document", title: "Expression of Interest", required: true, envelope: "ADMIN",
  tenderTypes: ["EOI", "REOI"],
};

const PRICE_SCHEDULE: DocumentSection = {
  id: "price-schedule", title: "Price Schedule", required: true, envelope: "FINANCIAL",
  tenderTypes: ["RFQ", "RFP", "ITB", "RFT"],
  condition: (ctx) => ctx.financialProposalRequired,
};

const FINANCIAL_PROPOSAL: DocumentSection = {
  id: "financial-proposal", title: "Financial Proposal", required: true, envelope: "FINANCIAL",
  tenderTypes: ["RFQ", "RFP", "ITB", "RFT", "works", "goods"],
  condition: (ctx) => ctx.financialProposalRequired,
};

const QUOTATION_COVER: DocumentSection = {
  id: "quotation-cover", title: "Quotation Cover Letter", required: true, envelope: "FINANCIAL",
  tenderTypes: ["RFQ"],
  condition: (ctx) => ctx.financialProposalRequired,
};

const TECHNICAL_COMPLIANCE: DocumentSection = {
  id: "technical-compliance", title: "Technical Compliance Statement", required: false, envelope: "TECHNICAL",
  tenderTypes: ["RFQ"],
};

// ─── Plan builder ───────────────────────────────────────────────────────────

/**
 * Build the document plan for a tender based on its type and context.
 */
export function buildDocumentPlan(ctx: TenderDocumentGenerationContext): DocumentPlan {
  const documents: DocumentPlan["documents"] = [];
  const skippedDocuments: DocumentPlan["skippedDocuments"] = [];

  const type = ctx.tenderType;

  // ─── EOI / REOI ───────────────────────────────────────────
  if (type === "EOI" || type === "REOI") {
    documents.push({
      type: "EXPRESSION_OF_INTEREST",
      title: "Expression of Interest",
      envelope: "ADMIN",
      sections: filterSections([COVER_LETTER, EOI_DOCUMENT, COMPANY_PROFILE, UNDERSTANDING, SIMILAR_PROJECTS, LEGAL_COMPLIANCE, SUBMISSION_CHECKLIST], ctx),
    });
    // EOI does NOT include technical methodology, work plan, team, or financial
    skippedDocuments.push({ type: "TECHNICAL_PROPOSAL", reason: "EOI does not require a technical proposal unless explicitly requested" });
    skippedDocuments.push({ type: "FINANCIAL_PROPOSAL", reason: "EOI does not require a financial proposal" });
    skippedDocuments.push({ type: "PRICE_SCHEDULE", reason: "EOI does not require a price schedule" });
    return { documents, skippedDocuments };
  }

  // ─── RFQ ──────────────────────────────────────────────────
  if (type === "RFQ") {
    documents.push({
      type: "QUOTATION",
      title: "Quotation",
      envelope: "FINANCIAL",
      sections: filterSections([QUOTATION_COVER, TECHNICAL_COMPLIANCE, PRICE_SCHEDULE, SUBMISSION_CHECKLIST], ctx),
    });
    if (!ctx.financialProposalRequired) {
      skippedDocuments.push({ type: "PRICE_SCHEDULE", reason: "Financial proposal not required for this tender" });
    }
    // RFQ does NOT generate a long technical proposal unless explicitly requested
    skippedDocuments.push({ type: "TECHNICAL_PROPOSAL", reason: "RFQ does not require a full technical proposal unless explicitly requested" });
    return { documents, skippedDocuments };
  }

  // ─── RFP / ITB / RFT / consultancy / works / framework ────
  // Technical proposal
  documents.push({
    type: "TECHNICAL_PROPOSAL",
    title: "Technical Proposal",
    envelope: "TECHNICAL",
    sections: filterSections([
      COVER_LETTER, UNDERSTANDING, TECHNICAL_APPROACH, WORK_PLAN,
      TEAM_COMPOSITION, EXPERT_ROLE_MATRIX, CV_SUMMARY,
      SIMILAR_PROJECTS, COMPLIANCE_MATRIX, LEGAL_COMPLIANCE, ANNEX_LIST, SUBMISSION_CHECKLIST,
    ], ctx),
  });

  // Financial proposal (only when required)
  if (ctx.financialProposalRequired) {
    documents.push({
      type: "FINANCIAL_PROPOSAL",
      title: "Financial Proposal",
      envelope: "FINANCIAL",
      sections: filterSections([FINANCIAL_PROPOSAL, PRICE_SCHEDULE], ctx),
    });
  } else {
    skippedDocuments.push({ type: "FINANCIAL_PROPOSAL", reason: "Tender states financial proposal is not required" });
    skippedDocuments.push({ type: "PRICE_SCHEDULE", reason: "Tender states financial proposal is not required" });
  }

  return { documents, skippedDocuments };
}

function filterSections(sections: DocumentSection[], ctx: TenderDocumentGenerationContext): DocumentSection[] {
  return sections.filter((s) => {
    // Check tender type
    if (s.tenderTypes !== "ALL" && !s.tenderTypes.includes(ctx.tenderType)) return false;
    // Check condition
    if (s.condition && !s.condition(ctx)) return false;
    return true;
  });
}
