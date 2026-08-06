import type { CompanyComplianceRecord, Expert, FinancialRecord, LegalRecord, Project, Tender } from "@prisma/client";

export type TenderFileForAnalysis = {
  id: string;
  originalFileName: string;
  mimeType: string;
  classification: string | null;
  extractedText: string | null;
};

export type TenderWithFiles = Tender & {
  files: TenderFileForAnalysis[];
};

export type RequirementDraft = {
  title: string;
  description: string;
  requirementType: string;
  priority: string;
  requiredQuantity?: number | null;
  pageLimit?: number | null;
  exactFileName?: string | null;
  exactOrder?: number | null;
  restrictions?: string | null;
  sectionReference?: string | null;
  sourceTenderFileId?: string | null;
  sourcePageNumber?: number | null;
  sourceSectionHeading?: string | null;
  sourceExactQuote?: string | null;
  sourceConfidence?: number;
  /**
   * Compatibility-only persisted diagnostic label. Historical rows may contain
   * values outside text/ocr/mixed. No source or generation gate may use this
   * field as authority; authority always requires current file ID, page, exact
   * quote, confidence, revision hash, and verified stored bytes.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sourceExtractionMethod?: any;
};

export type CompanyDocumentSnapshot = {
  id: string;
  category: string;
  originalFileName: string;
  extractedText: string | null;
};

export type CompanyKnowledgeSnapshot = {
  companyId: string;
  experts: Expert[];
  projects: Project[];
  documents: CompanyDocumentSnapshot[];
  legalRecords: LegalRecord[];
  financialRecords: FinancialRecord[];
  complianceRecords: CompanyComplianceRecord[];
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
    evidenceType: string;
    evidenceSource: string;
    evidenceReference?: string;
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
    exactOrder?: string | number | null;
    contentSummary: string;
  }>;
};

export const COMPANY_DOC_TYPE_BY_KEYWORD: Array<{ keyword: RegExp; type: string }> = [
  { keyword: /profile|brochure|company/i, type: "COMPANY_PROFILE" },
  { keyword: /registration|license|legal/i, type: "LEGAL_REGISTRATION" },
  { keyword: /financial|audit|statement/i, type: "FINANCIAL_STATEMENT" },
  { keyword: /cv|resume|expert/i, type: "EXPERT_CV" },
  { keyword: /reference|experience/i, type: "PROJECT_REFERENCE" },
  { keyword: /contract/i, type: "PROJECT_CONTRACT" },
  { keyword: /manual|policy/i, type: "MANUAL" },
  { keyword: /portfolio/i, type: "PORTFOLIO" },
  { keyword: /cert/i, type: "CERTIFICATION" },
  { keyword: /compliance/i, type: "COMPLIANCE_RECORD" },
];
