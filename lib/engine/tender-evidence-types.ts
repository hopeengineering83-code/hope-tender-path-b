export type TenderEvidenceSelection = {
  tenderId: string;
  companyId: string;
  sourceRevision: string;
  requirementMatches: RequirementEvidenceMatch[];
  selectedExperts: SelectedExpert[];
  selectedProjects: SelectedProjectReference[];
  selectedLegalRecords: SelectedLegalRecord[];
  selectedFinancialRecords: SelectedFinancialRecord[];
  selectedAssets: SelectedCompanyAsset[];
  missingEvidence: MissingEvidenceGap[];
  warnings: string[];
  blockers: string[];
  score: number;
};

export type RequirementEvidenceMatch = {
  requirementId: string;
  requirementText: string;
  priority: "MANDATORY" | "IMPORTANT" | "OPTIONAL" | "UNKNOWN";
  evidenceType:
    | "COMPANY_PROFILE"
    | "LICENSE"
    | "CERTIFICATE"
    | "PROJECT_REFERENCE"
    | "EXPERT_CV"
    | "LEGAL_RECORD"
    | "FINANCIAL_RECORD"
    | "ASSET"
    | "MANUAL";
  evidenceId: string;
  evidenceTitle: string;
  relevanceScore: number;
  reason: string;
  sourceQuote?: string;
  status: "matched" | "weak_match" | "missing" | "manual_required";
};

export type MissingEvidenceGap = {
  gapType:
    | "MISSING_EXPERT_CV"
    | "MISSING_PROJECT_REFERENCE"
    | "MISSING_LICENSE"
    | "MISSING_CERTIFICATE"
    | "MISSING_LEGAL_RECORD"
    | "MISSING_FINANCIAL_RECORD"
    | "MISSING_ASSET"
    | "MISSING_COMPANY_PROFILE"
    | "MISSING_MANUAL_INPUT";
  requirementId?: string;
  requirementText?: string;
  severity: "draft_warning" | "final_blocker";
  reason: string;
  nextAction:
    | "UPLOAD_CV"
    | "UPLOAD_PROJECT_REFERENCE"
    | "UPLOAD_LICENSE"
    | "UPLOAD_CERTIFICATE"
    | "UPLOAD_LEGAL_DOCUMENT"
    | "UPLOAD_FINANCIAL_RECORD"
    | "UPLOAD_ASSET"
    | "CONFIRM_COMPANY_PROFILE"
    | "EDIT_MANUALLY"
    | "MARK_NOT_APPLICABLE";
};

export type SelectedExpert = {
  expertId: string;
  fullName: string;
  role: string;
  relevanceScore: number;
  reason: string;
  fileId?: string;
};

export type SelectedProjectReference = {
  projectId: string;
  projectName: string;
  relevanceScore: number;
  reason: string;
  evidenceFileIds: string[];
};

export type SelectedLegalRecord = {
  recordId: string;
  title: string;
  isValid: boolean;
  expiryDate?: Date | null;
  reason: string;
  fileId?: string;
};

export type SelectedFinancialRecord = {
  recordId: string;
  fiscalYear: number;
  recordType: string;
  reason: string;
  fileId?: string;
};

export type SelectedCompanyAsset = {
  assetId: string;
  assetType: string;
  fileName: string;
  reason: string;
};
