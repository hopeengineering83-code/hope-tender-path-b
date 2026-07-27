/**
 * Content-capability document classifier.
 *
 * Replaces category-only classification that skipped expert/project
 * extraction when a document was uploaded as "COMPANY_PROFILE" or "OTHER".
 */
export type DocumentCapability =
  | "EXPERT_CV"
  | "PROJECT_REFERENCE"
  | "COMPANY_PROFILE"
  | "LEGAL_REGISTRATION"
  | "FINANCIAL_STATEMENT"
  | "COMPLIANCE_RECORD"
  | "OTHER";

export type DocumentClassification = {
  capabilities: DocumentCapability[];
  hasExpertData: boolean;
  hasProjectData: boolean;
  hasCompanyFacts: boolean;
  hasLegalData: boolean;
  hasFinancialData: boolean;
  hasComplianceData: boolean;
  confidence: number;
};

const EXPERT_TEXT_PATTERNS = [
  /\bcurriculum\s*vitae\b/i, /\bcv\b\s*(of|for|:)/i,
  /\bname\s+of\s+(expert|key\s+staff|personnel)\b/i,
  /\bproposed\s+(position|role)\b/i, /\byears?\s+of\s+experience\b/i,
  /\bqualifications?\s*:/i, /\bkey\s+(staff|personnel|experts?)\b/i,
];
const PROJECT_TEXT_PATTERNS = [
  /\bproject\s+(name|title|description)\b/i, /\bclient\s+name\b/i,
  /\bcontract\s+(value|amount)\b/i, /\bselected\s+projects?\b/i,
  /\bpast\s+projects?\b/i, /\bportfolio\b/i,
];

function matchAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

export function classifyDocumentContent(
  fileName: string, category: string, extractedText: string | null | undefined,
): DocumentClassification {
  const text = extractedText ?? "";
  const hasExpertData = matchAny(text, EXPERT_TEXT_PATTERNS) || /cv|expert|staff|resume|personnel|curriculum/i.test(fileName);
  const hasProjectData = matchAny(text, PROJECT_TEXT_PATTERNS) || /project|portfolio|reference|contract/i.test(fileName);
  const hasCompanyFacts = /\b(founded|established|company\s+profile|registration\s+number)\b/i.test(text);
  const hasLegalData = /\b(trade\s+license|business\s+license|registration\s+certificate)\b/i.test(text);
  const hasFinancialData = /\b(financial\s+statement|balance\s+sheet|audit\s+report)\b/i.test(text);
  const hasComplianceData = /\b(iso\s*\d+|quality\s+certificate|compliance\s+certificate)\b/i.test(text);

  const capabilities: DocumentCapability[] = [];
  if (hasExpertData) capabilities.push("EXPERT_CV");
  if (hasProjectData) capabilities.push("PROJECT_REFERENCE");
  if (hasCompanyFacts) capabilities.push("COMPANY_PROFILE");
  if (hasLegalData) capabilities.push("LEGAL_REGISTRATION");
  if (hasFinancialData) capabilities.push("FINANCIAL_STATEMENT");
  if (hasComplianceData) capabilities.push("COMPLIANCE_RECORD");
  if (capabilities.length === 0) capabilities.push("OTHER");

  const matchCount = [hasExpertData, hasProjectData, hasCompanyFacts, hasLegalData, hasFinancialData, hasComplianceData].filter(Boolean).length;
  return { capabilities, hasExpertData, hasProjectData, hasCompanyFacts, hasLegalData, hasFinancialData, hasComplianceData, confidence: Math.min(1, matchCount / 2) };
}

export function shouldScanForExperts(fileName: string, category: string, extractedText: string | null | undefined): boolean {
  return classifyDocumentContent(fileName, category, extractedText).hasExpertData;
}
export function shouldScanForProjects(fileName: string, category: string, extractedText: string | null | undefined): boolean {
  return classifyDocumentContent(fileName, category, extractedText).hasProjectData;
}
