import type { CompanyDocument, CompanyDocumentType, Expert, Project, Tender, TenderFile, TenderRequirement } from "@prisma/client";

export type TenderWithFiles = Tender & {
  files: TenderFile[];
};

export type RequirementDraft = {
  title: string;
  description: string;
  requirementType: TenderRequirement["requirementType"];
  priority: TenderRequirement["priority"];
  requiredQuantity?: number | null;
  exactFileName?: string | null;
  exactOrder?: number | null;
  restrictions?: string | null;
  sectionReference?: string | null;
};

export type CompanyKnowledgeSnapshot = {
  companyId: string;
  experts: Expert[];
  projects: Project[];
  documents: Pick<CompanyDocument, "id" | "type" | "originalFileName" | "classification">[];
};

export type AnalysisResult = {
  summary: string;
  requirements: RequirementDraft[];
  exactFileNaming: string[];
  exactFileOrder: string[];
};

export type MatchingResult = {
  expertMatches: Array<{
    expertId: string;
    score: number;
    rationale: string;
    evidenceSummary: string;
    isSelected: boolean;
  }>;
  projectMatches: Array<{
    projectId: string;
    score: number;
    rationale: string;
    evidenceSummary: string;
    isSelected: boolean;
  }>;
};

export type ComplianceResult = {
  matrices: Array<{
    requirementTitle: string;
    requirementId: string;
    supportStatus: string;
    supportStrength: number;
    evidenceSummary: string;
    notes?: string;
  }>;
  gaps: Array<{
    requirementId?: string;
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    title: string;
    description: string;
    mitigationPlan?: string;
  }>;
};

export type DocumentPlanResult = {
  documents: Array<{
    name: string;
    documentType: string;
    exactFileName?: string | null;
    exactOrder?: number | null;
    contentSummary: string;
  }>;
};

export const COMPANY_DOC_TYPE_BY_KEYWORD: Array<{ keyword: RegExp; type: CompanyDocumentType }> = [
  { keyword: /profile|brochure|company/i, type: "COMPANY_PROFILE" as CompanyDocumentType },
  { keyword: /registration|license|legal/i, type: "LEGAL_REGISTRATION" as CompanyDocumentType },
  { keyword: /financial|audit|statement/i, type: "FINANCIAL_STATEMENT" as CompanyDocumentType },
  { keyword: /cv|resume|expert/i, type: "EXPERT_CV" as CompanyDocumentType },
  { keyword: /reference|experience/i, type: "PROJECT_REFERENCE" as CompanyDocumentType },
  { keyword: /contract/i, type: "PROJECT_CONTRACT" as CompanyDocumentType },
  { keyword: /manual|policy/i, type: "MANUAL" as CompanyDocumentType },
  { keyword: /portfolio/i, type: "PORTFOLIO" as CompanyDocumentType },
  { keyword: /cert/i, type: "CERTIFICATION" as CompanyDocumentType },
  { keyword: /compliance/i, type: "COMPLIANCE_RECORD" as CompanyDocumentType },
];
