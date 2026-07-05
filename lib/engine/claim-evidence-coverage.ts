export type ClaimEvidenceFinding = {
  category: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  detail: string;
  nextAction: string;
};

export type ClaimEvidenceInput = {
  company?: {
    profileSummary?: string | null;
    description?: string | null;
    licenseGrade?: string | null;
    legalRecords?: Array<{ id: string }>;
    financialRecords?: Array<{ id: string }>;
    complianceRecords?: Array<{ id: string }>;
    documents?: Array<{ id: string; category?: string | null; extractedText?: string | null; aiExtractionStatus?: string | null }>;
  } | null;
  selectedReviewedExperts?: Array<{ id: string; sourceDocumentId?: string | null; profile?: string | null }>;
  selectedReviewedProjects?: Array<{ id: string; sourceDocumentId?: string | null; summary?: string | null; evidences?: Array<{ id: string }> }>;
  tenderText?: string | null;
  generatedText?: string | null;
};

function combinedText(input: ClaimEvidenceInput): string {
  return `${input.tenderText ?? ""}\n${input.generatedText ?? ""}\n${input.company?.profileSummary ?? ""}\n${input.company?.description ?? ""}`;
}

function hasExtractedDocs(company: ClaimEvidenceInput["company"], pattern: RegExp): boolean {
  return Boolean(company?.documents?.some((doc) => pattern.test(`${doc.category ?? ""} ${doc.extractedText ?? ""}`) && ((doc.extractedText ?? "").trim().length > 80 || doc.aiExtractionStatus === "EXTRACTED")));
}

function hasReviewedExpertEvidence(input: ClaimEvidenceInput): boolean {
  return Boolean(input.selectedReviewedExperts?.some((expert) => Boolean(expert.sourceDocumentId) || (expert.profile ?? "").trim().length > 80));
}

function hasReviewedProjectEvidence(input: ClaimEvidenceInput): boolean {
  return Boolean(input.selectedReviewedProjects?.some((project) => Boolean(project.sourceDocumentId) || (project.evidences?.length ?? 0) > 0 || (project.summary ?? "").trim().length > 80));
}

export function checkHighValueClaimEvidence(input: ClaimEvidenceInput): ClaimEvidenceFinding[] {
  const findings: ClaimEvidenceFinding[] = [];
  const company = input.company;
  const text = combinedText(input);

  if (/\bgrade\s*[- ]?1\b|\bgrade\s+one\b|\bfirst\s+grade\b/i.test(`${text} ${company?.licenseGrade ?? ""}`) && !company?.licenseGrade && !hasExtractedDocs(company, /grade\s*[- ]?1|grade\s+one|competence|license|licen[cs]e/i)) {
    findings.push({ severity: "HIGH", category: "CLAIM_EVIDENCE_GRADE", title: "Grade/licence claim lacks reviewed evidence", detail: "A Grade 1 or competence/licence claim may be used, but no structured licence grade or extracted licence evidence is available.", nextAction: "Add/review the competence certificate or licence document before using this claim." });
  }

  if (/\b(unhcr|igad|world\s+bank|undp|kfw|french\s+government|major\s+clients?)\b/i.test(text) && !hasExtractedDocs(company, /unhcr|igad|world\s+bank|undp|kfw|french\s+government|client|contract|reference/i)) {
    findings.push({ severity: "HIGH", category: "CLAIM_EVIDENCE_CLIENTS", title: "Major-client claim lacks source evidence", detail: "A major-client or international-client claim appears, but no extracted company document supports it.", nextAction: "Attach/review project references, contracts, certificates, or client evidence before final export." });
  }

  if (/\b\d{2,}\+?\s+(certified\s+)?(projects?|assignments?|contracts?)\b/i.test(text) && !hasReviewedProjectEvidence(input) && !hasExtractedDocs(company, /projects?|assignments?|contracts?|portfolio|experience/i)) {
    findings.push({ severity: "HIGH", category: "CLAIM_EVIDENCE_PROJECT_COUNT", title: "Project-count claim lacks evidence", detail: "A numeric project/assignment count appears, but no reviewed project evidence or extracted portfolio support is available.", nextAction: "Review project records or upload a source-backed portfolio before using project-count claims." });
  }

  if (/\b(experts?|key\s+personnel|staff|cv|curriculum\s+vitae)\b/i.test(text) && !hasReviewedExpertEvidence(input)) {
    findings.push({ severity: "MEDIUM", category: "CLAIM_EVIDENCE_EXPERTS", title: "Expert/personnel claims need reviewed CV evidence", detail: "Expert/personnel language appears, but no selected reviewed expert has source evidence or a substantial reviewed profile.", nextAction: "Select reviewed experts and attach/review source CV evidence before final proposal generation/export." });
  }

  if (/\b(registration|registered|licen[cs]e|tax\s+clearance|tin|vat|legal\s+eligibility)\b/i.test(text) && (company?.legalRecords?.length ?? 0) === 0 && !hasExtractedDocs(company, /registration|licen[cs]e|tax|tin|vat|legal/i)) {
    findings.push({ severity: "MEDIUM", category: "CLAIM_EVIDENCE_LEGAL", title: "Legal eligibility claims lack structured evidence", detail: "Legal/registration/tax language appears, but no structured legal records or extracted legal documents are available.", nextAction: "Add/review legal registration, tax, licence, TIN/VAT, or eligibility documents." });
  }

  if (/\b(financial\s+capacity|audited|turnover|bank\s+reference|financial\s+statement)\b/i.test(text) && (company?.financialRecords?.length ?? 0) === 0 && !hasExtractedDocs(company, /audited|turnover|bank|financial\s+statement|financial\s+capacity/i)) {
    findings.push({ severity: "MEDIUM", category: "CLAIM_EVIDENCE_FINANCIAL", title: "Financial-capacity claims lack evidence", detail: "Financial-capacity language appears, but no structured financial records or extracted financial evidence are available.", nextAction: "Add/review audited financials, turnover records, or bank references before using financial claims." });
  }

  return findings;
}
