export type DocumentCapability = "EXPERT_CV" | "PROJECT_REFERENCE" | "COMPANY_PROFILE" | "LEGAL_REGISTRATION" | "FINANCIAL_STATEMENT" | "COMPLIANCE_RECORD" | "OTHER";
export type DocumentClassification = { capabilities: DocumentCapability[]; hasExpertData: boolean; hasProjectData: boolean; hasCompanyFacts: boolean; hasLegalData: boolean; hasFinancialData: boolean; hasComplianceData: boolean; confidence: number; };
const EP = [/\bcurriculum\s*vitae\b/i, /\bcvs?\b/i, /\bresumes?\b/i, /\bname\s+of\s+(expert|key\s+staff|personnel)\b/i, /\bproposed\s+(position|role)\b/i, /\byears?\s+of\s+experience\b/i, /\bqualifications?\s*:/i, /\b(key|professional)\s+(staff|personnel|experts?|team)\b/i];
const PP = [/\bproject\s+(name|title|description|references?|experience)\b/i, /\bsimilar\s+assignments?\b/i, /\bclient\s+references?\b/i, /\bcontracts?\b/i, /\bassignments?\b/i, /\bclient\s+name\b/i, /\bcontract\s+(value|amount)\b/i, /\bselected\s+projects?\b/i, /\bpast\s+projects?\b/i, /\bportfolio\b/i];
function ma(text: string, p: RegExp[]): boolean { return p.some((r) => r.test(text)); }
export function classifyDocumentContent(fn: string, cat: string, t: string | null | undefined): DocumentClassification {
  const text = t ?? "";
  const hasExpertData = ma(text, EP) || /cv|expert|staff|resume|personnel|curriculum/i.test(fn);
  const hasProjectData = ma(text, PP) || /project|portfolio|reference|contract/i.test(fn);
  const hasCompanyFacts = /\b(founded|established|company\s+profile|registration\s+number)\b/i.test(text);
  const hasLegalData = /\b(trade\s+license|business\s+license|registration\s+certificate)\b/i.test(text);
  const hasFinancialData = /\b(financial\s+statement|balance\s+sheet|audit\s+report)\b/i.test(text);
  const hasComplianceData = /\b(iso\s*\d+|quality\s+certificate|compliance\s+certificate)\b/i.test(text);
  const caps: DocumentCapability[] = [];
  if (hasExpertData) caps.push("EXPERT_CV");
  if (hasProjectData) caps.push("PROJECT_REFERENCE");
  if (hasCompanyFacts) caps.push("COMPANY_PROFILE");
  if (hasLegalData) caps.push("LEGAL_REGISTRATION");
  if (hasFinancialData) caps.push("FINANCIAL_STATEMENT");
  if (hasComplianceData) caps.push("COMPLIANCE_RECORD");
  if (caps.length === 0) caps.push("OTHER");
  const mc = [hasExpertData, hasProjectData, hasCompanyFacts, hasLegalData, hasFinancialData, hasComplianceData].filter(Boolean).length;
  return { capabilities: caps, hasExpertData, hasProjectData, hasCompanyFacts, hasLegalData, hasFinancialData, hasComplianceData, confidence: Math.min(1, mc / 2) };
}
export function shouldScanForExperts(fn: string, cat: string, t: string | null | undefined): boolean { return classifyDocumentContent(fn, cat, t).hasExpertData; }
export function shouldScanForProjects(fn: string, cat: string, t: string | null | undefined): boolean { return classifyDocumentContent(fn, cat, t).hasProjectData; }
