/**
 * Content-capability document classifier.
 *
 * Replaces the old category-only classification that skipped expert/project
 * extraction when a document was uploaded as "COMPANY_PROFILE", "OTHER", or
 * any broad category. This classifier inspects the actual extracted text
 * to determine what capabilities a document contains, regardless of its
 * declared category.
 *
 * A single document may contain multiple capabilities — e.g. a company
 * profile that also lists key staff (experts) and past projects.
 */

export type DocumentCapability =
  | "EXPERT_CV"
  | "PROJECT_REFERENCE"
  | "COMPANY_PROFILE"
  | "LEGAL_REGISTRATION"
  | "FINANCIAL_STATEMENT"
  | "COMPLIANCE_RECORD"
  | "CERTIFICATION"
  | "BRAND_ASSET"
  | "OTHER";

export type DocumentClassification = {
  /** Capabilities detected in the document text. */
  capabilities: DocumentCapability[];
  /** True if the text contains expert/CV/staff data. */
  hasExpertData: boolean;
  /** True if the text contains project/portfolio/reference data. */
  hasProjectData: boolean;
  /** True if the text contains company profile facts. */
  hasCompanyFacts: boolean;
  /** True if the text contains legal/registration data. */
  hasLegalData: boolean;
  /** True if the text contains financial data. */
  hasFinancialData: boolean;
  /** True if the text contains compliance/certification data. */
  hasComplianceData: boolean;
  /** Confidence score 0-1 for the classification. */
  confidence: number;
};

// Expert/CV indicators — checked against document text, not category
const EXPERT_TEXT_PATTERNS = [
  /\bcurriculum\s*vitae\b/i,
  /\bcv\b\s*(of|for|:)/i,
  /\bname\s+of\s+(expert|key\s+staff|personnel|professional)\b/i,
  /\bproposed\s+(position|role|expert)\b/i,
  /\byears?\s+of\s+experience\b/i,
  /\bqualifications?\s*:/i,
  /\beducation\s*:/i,
  /\bemployment\s+history\b/i,
  /\bprofessional\s+registration\b/i,
  /\blicense\s+number\b/i,
  /\bdisciplines?\s*:/i,
  /\bsectors?\s*:/i,
  /\bkey\s+(staff|personnel|experts?)\b/i,
];

// Project/portfolio indicators
const PROJECT_TEXT_PATTERNS = [
  /\bproject\s+(name|title|description)\b/i,
  /\bclient\s+name\b/i,
  /\bcontract\s+(value|amount|sum)\b/i,
  /\bselected\s+projects?\b/i,
  /\bpast\s+projects?\b/i,
  /\bportfolio\b/i,
  /\bassignment\s+name\b/i,
  /\bname\s+of\s+(assignment|project)\b/i,
  /\bcompleted\s+projects?\b/i,
  /\breference\s+projects?\b/i,
  /\byear\s+completed\b/i,
  /\bproject\s+location\b/i,
];

// Company profile indicators
const COMPANY_FACT_PATTERNS = [
  /\bfounded\b/i,
  /\bestablished\b/i,
  /\bheadquarters\b/i,
  /\bcompany\s+(profile|overview|description)\b/i,
  /\bregistration\s+number\b/i,
  /\btax\s+identification\b/i,
  /\bvat\s+number\b/i,
  /\bgeneral\s+manager\b/i,
  /\bmanaging\s+director\b/i,
  /\blicense\s+grade\b/i,
  /\bnumber\s+of\s+employees\b/i,
  /\bstaff\s+strength\b/i,
];

// Legal/registration indicators
const LEGAL_TEXT_PATTERNS = [
  /\btrade\s+license\b/i,
  /\bbusiness\s+license\b/i,
  /\bregistration\s+certificate\b/i,
  /\barticles\s+of\s+(incorporation|association)\b/i,
  /\bmemorandum\s+of\s+association\b/i,
  /\bcommercial\s+registration\b/i,
];

// Financial indicators
const FINANCIAL_TEXT_PATTERNS = [
  /\bfinancial\s+statement\b/i,
  /\bbalance\s+sheet\b/i,
  /\bincome\s+statement\b/i,
  /\bcash\s+flow\b/i,
  /\baudit\s+report\b/i,
  /\bannual\s+report\b/i,
  /\bturnover\b/i,
  /\brevenue\b/i,
];

// Compliance/certification indicators
const COMPLIANCE_TEXT_PATTERNS = [
  /\bisO\s*\d+/i,
  /\bquality\s+(management|certificate|certification)\b/i,
  /\bcompliance\s+certificate\b/i,
  /\boccupational\s+health\b/i,
  /\bsafety\s+certificate\b/i,
  /\benvironmental\s+(management|certificate)\b/i,
];

function matchAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, p) => count + (p.test(text) ? 1 : 0), 0);
}

/**
 * Classify a company document by inspecting its extracted text content.
 *
 * This replaces the old `EXPERT_IMPORT_CATEGORIES.has(doc.category)` check
 * which skipped expert extraction when a CV was uploaded as "COMPANY_PROFILE"
 * or "OTHER". Now the classifier inspects the actual text and detects
 * capabilities regardless of the declared category.
 */
export function classifyDocumentContent(
  fileName: string,
  category: string,
  extractedText: string | null | undefined,
): DocumentClassification {
  const text = extractedText ?? "";
  const label = `${fileName} ${category}`.toLowerCase();

  const hasExpertData = matchAny(text, EXPERT_TEXT_PATTERNS) || /cv|expert|staff|resume|personnel|curriculum/i.test(label);
  const hasProjectData = matchAny(text, PROJECT_TEXT_PATTERNS) || /project|portfolio|reference|contract/i.test(label);
  const hasCompanyFacts = matchAny(text, COMPANY_FACT_PATTERNS) || /company|profile/i.test(label);
  const hasLegalData = matchAny(text, LEGAL_TEXT_PATTERNS);
  const hasFinancialData = matchAny(text, FINANCIAL_TEXT_PATTERNS);
  const hasComplianceData = matchAny(text, COMPLIANCE_TEXT_PATTERNS);

  const capabilities: DocumentCapability[] = [];
  if (hasExpertData) capabilities.push("EXPERT_CV");
  if (hasProjectData) capabilities.push("PROJECT_REFERENCE");
  if (hasCompanyFacts) capabilities.push("COMPANY_PROFILE");
  if (hasLegalData) capabilities.push("LEGAL_REGISTRATION");
  if (hasFinancialData) capabilities.push("FINANCIAL_STATEMENT");
  if (hasComplianceData) capabilities.push("COMPLIANCE_RECORD");

  // Always include OTHER as a fallback
  if (capabilities.length === 0) capabilities.push("OTHER");

  // Confidence: how many pattern categories matched
  const totalChecks = 6;
  const matchCount = [hasExpertData, hasProjectData, hasCompanyFacts, hasLegalData, hasFinancialData, hasComplianceData]
    .filter(Boolean).length;
  const confidence = Math.min(1, matchCount / 2); // 2+ matches = 100% confidence

  return {
    capabilities,
    hasExpertData,
    hasProjectData,
    hasCompanyFacts,
    hasLegalData,
    hasFinancialData,
    hasComplianceData,
    confidence,
  };
}

/**
 * Check if a document should be scanned for expert data.
 * Uses content-capability classification, NOT category-only.
 */
export function shouldScanForExperts(
  fileName: string,
  category: string,
  extractedText: string | null | undefined,
): boolean {
  const classification = classifyDocumentContent(fileName, category, extractedText);
  return classification.hasExpertData;
}

/**
 * Check if a document should be scanned for project data.
 * Uses content-capability classification, NOT category-only.
 */
export function shouldScanForProjects(
  fileName: string,
  category: string,
  extractedText: string | null | undefined,
): boolean {
  const classification = classifyDocumentContent(fileName, category, extractedText);
  return classification.hasProjectData;
}
