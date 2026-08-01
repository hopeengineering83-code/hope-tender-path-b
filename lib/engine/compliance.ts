import type { CompanyKnowledgeSnapshot, ComplianceResult, MatchingResult, RequirementDraft } from "./types";

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }

function hasSupportDocument(knowledge: CompanyKnowledgeSnapshot, patterns: RegExp[]): boolean {
  return Boolean(findSupportDocument(knowledge, patterns));
}

/**
 * Selects actual, usable Company Vault evidence for a requirement.  A filename
 * alone is not enough: Run Engine must have extracted content to review before
 * it can claim that the Vault supports a tender requirement.
 *
 * Keeping this resolver here also prevents the old "first document in the
 * Vault" fallback from attaching an unrelated source reference.
 */
export function findSupportDocument(knowledge: CompanyKnowledgeSnapshot, patterns: RegExp[]) {
  return knowledge.documents.find((doc) => {
    const extractedText = (doc.extractedText ?? "").trim();
    if (extractedText.length < 40 || /^\[(?:Scanned PDF|Extraction failed|Image:|Legacy \.doc)/i.test(extractedText)) return false;
    const searchableEvidence = `${doc.category} ${doc.originalFileName} ${extractedText}`;
    return patterns.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(searchableEvidence);
    });
  });
}

const REQUIREMENT_MATCH_STOP_WORDS = new Set([
  "company", "document", "documents", "evidence", "provide", "required", "requirement",
  "submission", "tender", "proposal", "technical", "valid", "form", "forms",
]);

export function findRequirementSupportDocument(knowledge: CompanyKnowledgeSnapshot, requirement: RequirementDraft) {
  const terms = `${requirement.title} ${requirement.description}`
    .toLowerCase()
    .match(/[a-z0-9]{4,}/g)
    ?.filter((term, index, all) => !REQUIREMENT_MATCH_STOP_WORDS.has(term) && all.indexOf(term) === index)
    .slice(0, 8) ?? [];
  if (terms.length === 0) return undefined;
  const requiredMatches = terms.length === 1 ? 1 : 2;
  return knowledge.documents.find((doc) => {
    const extractedText = (doc.extractedText ?? "").trim();
    if (extractedText.length < 40 || /^\[(?:Scanned PDF|Extraction failed|Image:|Legacy \.doc)/i.test(extractedText)) return false;
    const searchableEvidence = `${doc.category} ${doc.originalFileName} ${extractedText}`.toLowerCase();
    return terms.filter((term) => searchableEvidence.includes(term)).length >= requiredMatches;
  });
}

function nonCriticalRequirement(type: string): boolean {
  return ["FORMAT", "SUBMISSION_RULE", "FORM", "ANNEX", "SCHEDULE", "TECHNICAL", "METHODOLOGY", "COMPANY_PROFILE", "DECLARATION"].includes(type);
}

function isProposalResponseRequirement(type: string): boolean {
  return ["FORMAT", "SUBMISSION_RULE", "FORM", "ANNEX", "SCHEDULE", "TECHNICAL", "METHODOLOGY", "COMPANY_PROFILE", "DECLARATION"].includes(type);
}

export function buildCompliance(
  requirementIds: Array<{ id: string; requirement: RequirementDraft }>,
  knowledge: CompanyKnowledgeSnapshot,
  matching: MatchingResult,
): ComplianceResult {
  const selectedExperts = matching.expertMatches.filter((match) => match.isSelected);
  const selectedProjects = matching.projectMatches.filter((match) => match.isSelected);
  const highScoringExperts = matching.expertMatches.filter((match) => match.score >= 0.75);
  const highScoringProjects = matching.projectMatches.filter((match) => match.score >= 0.75);

  const expertCount = knowledge.experts.length;
  const projectCount = knowledge.projects.length;
  const legalCount = knowledge.legalRecords.length || (hasSupportDocument(knowledge, [/LEGAL_REGISTRATION/i, /registration/i, /license/i, /licence/i, /certificate/i, /tin/i, /vat/i]) ? 1 : 0);
  const financialCount = knowledge.financialRecords.length || (hasSupportDocument(knowledge, [/FINANCIAL_STATEMENT/i, /audit/i, /financial/i, /turnover/i, /balance/i]) ? 1 : 0);
  const complianceCount = knowledge.complianceRecords.length || (hasSupportDocument(knowledge, [/CERTIFICATION/i, /COMPLIANCE_RECORD/i, /MANUAL/i, /declaration/i, /certificate/i, /policy/i, /manual/i]) ? 1 : 0);
  const companyProfileCount = hasSupportDocument(knowledge, [/COMPANY_PROFILE/i, /company profile/i, /service lines/i, /consultancy/i]) ? 1 : 0;
  const selectedEvidenceCount = selectedExperts.length + selectedProjects.length;

  const matrices: ComplianceResult["matrices"] = [];
  const gaps: ComplianceResult["gaps"] = [];

  for (const item of requirementIds) {
    const req = item.requirement;
    let supportStrength = 0;
    let supportStatus = "UNSUPPORTED";
    let evidenceSummary = "No mapped company evidence yet.";
    let evidenceType = "UNMAPPED";
    let evidenceSource = "No evidence source selected";
    let evidenceReference: string | undefined;

    const legalDocument = findSupportDocument(knowledge, [/LEGAL_REGISTRATION/i, /registration/i, /licen[cs]e/i, /certificate/i, /\btin\b/i, /\bvat\b/i]);
    const financialDocument = findSupportDocument(knowledge, [/FINANCIAL_STATEMENT/i, /audit/i, /financial/i, /turnover/i, /balance sheet/i]);
    const complianceDocument = findSupportDocument(knowledge, [/CERTIFICATION/i, /COMPLIANCE_RECORD/i, /MANUAL/i, /declaration/i, /certificate/i, /policy/i, /manual/i]);
    const profileDocument = findSupportDocument(knowledge, [/COMPANY_PROFILE/i, /company profile/i, /service lines/i, /consultancy/i]);
    const requirementDocument = findRequirementSupportDocument(knowledge, req);

    if (req.requirementType === "EXPERT") {
      const denominator = Math.max(req.requiredQuantity || 1, 1);
      const strongSelected = selectedExperts.length;
      const seniorRelevant = highScoringExperts.length;
      supportStrength = expertCount > 0 ? clamp01(Math.max(strongSelected / denominator, seniorRelevant > 0 ? 0.72 : 0)) : 0;
      supportStatus = strongSelected > 0 ? "SUPPORTED" : supportStrength >= 0.7 ? "EVIDENCE_PENDING_REVIEW" : supportStrength > 0 ? "PARTIAL" : "UNSUPPORTED";
      evidenceSummary = strongSelected > 0
        ? `${strongSelected} reviewed/selected expert(s) are available from ${expertCount} expert record(s). If the tender asks for more people, the proposal engine will write a staffing-compliance narrative and flag the balance for substitution/partner confirmation instead of blocking generation.`
        : `${seniorRelevant} expert candidate(s) scored 75%+ from ${expertCount} expert record(s); senior review/selection required if no candidate reaches 90%.`;
      evidenceType = "EXPERT";
      evidenceSource = strongSelected > 0 ? "Selected expert library" : "Expert library candidates";
      evidenceReference = (strongSelected > 0 ? selectedExperts : highScoringExperts).map((match) => match.expertId).slice(0, 3).join(", ") || undefined;
    } else if (req.requirementType === "PROJECT_EXPERIENCE") {
      const denominator = Math.max(req.requiredQuantity || 1, 1);
      const strongSelected = selectedProjects.length;
      const seniorRelevant = highScoringProjects.length;
      supportStrength = projectCount > 0 ? clamp01(Math.max(strongSelected / denominator, seniorRelevant > 0 ? 0.72 : 0)) : 0;
      supportStatus = strongSelected > 0 ? "SUPPORTED" : supportStrength >= 0.7 ? "EVIDENCE_PENDING_REVIEW" : supportStrength > 0 ? "PARTIAL" : "UNSUPPORTED";
      evidenceSummary = strongSelected > 0
        ? `${strongSelected} selected project reference(s) are available from ${projectCount} project record(s). If the tender asks for additional references, the proposal engine will emphasize strongest relevant proof and flag any remaining balance for final bid review.`
        : `${seniorRelevant} project candidate(s) scored 75%+ from ${projectCount} available project record(s); senior review/selection required if no candidate reaches 90%.`;
      evidenceType = "PROJECT";
      evidenceSource = strongSelected > 0 ? "Selected project references" : "Project library candidates";
      evidenceReference = (strongSelected > 0 ? selectedProjects : highScoringProjects).map((match) => match.projectId).slice(0, 3).join(", ") || undefined;
    } else if (["LEGAL", "ELIGIBILITY", "REGISTRATION"].includes(req.requirementType)) {
      supportStrength = legalCount > 0 ? 1 : 0;
      supportStatus = supportStrength >= 0.75 ? "SUPPORTED" : supportStrength > 0 ? "EVIDENCE_PENDING_REVIEW" : "UNSUPPORTED";
      evidenceSummary = legalCount > 0 ? `${legalCount} legal/company registration evidence source(s) automatically reviewed and matched.` : "No relevant legal/company registration evidence was found in the Company Vault.";
      evidenceType = legalCount > 0 ? "LEGAL_RECORD" : "UNMAPPED";
      evidenceSource = legalCount > 0 ? "Company legal/support documents" : "No legal records found";
      evidenceReference = knowledge.legalRecords[0]?.referenceNumber ?? knowledge.legalRecords[0]?.title ?? legalDocument?.originalFileName;
    } else if (["FINANCIAL", "FINANCIAL_CAPACITY"].includes(req.requirementType)) {
      supportStrength = financialCount > 0 ? 1 : 0;
      supportStatus = supportStrength >= 0.75 ? "SUPPORTED" : supportStrength > 0 ? "EVIDENCE_PENDING_REVIEW" : "UNSUPPORTED";
      evidenceSummary = financialCount > 0 ? `${financialCount} financial evidence source(s) automatically reviewed and matched.` : "No relevant financial evidence was found in the Company Vault.";
      evidenceType = financialCount > 0 ? "FINANCIAL_RECORD" : "UNMAPPED";
      evidenceSource = financialCount > 0 ? "Company financial/support documents" : "No financial records found";
      evidenceReference = knowledge.financialRecords[0] ? `${knowledge.financialRecords[0].recordType} ${knowledge.financialRecords[0].fiscalYear}` : financialDocument?.originalFileName;
    } else if (["COMPLIANCE", "CERTIFICATION", "DECLARATION"].includes(req.requirementType)) {
      supportStrength = complianceCount > 0 ? 1 : 0;
      supportStatus = supportStrength >= 1 ? "SUPPORTED" : "UNSUPPORTED";
      evidenceSummary = complianceCount > 0 ? `${complianceCount} compliance/certification/support evidence source(s) automatically reviewed and matched.` : "No relevant compliance or supporting document was found in the Company Vault.";
      evidenceType = complianceCount > 0 ? "COMPANY_COMPLIANCE_RECORD" : "UNMAPPED";
      evidenceSource = complianceCount > 0 ? "Company compliance/support documents" : "No relevant Company Vault evidence found";
      evidenceReference = knowledge.complianceRecords[0]?.referenceNumber ?? complianceDocument?.originalFileName;
    } else if (req.requirementType === "COMPANY_PROFILE") {
      supportStrength = companyProfileCount > 0 ? 1 : 0;
      supportStatus = supportStrength >= 1 ? "SUPPORTED" : "UNSUPPORTED";
      evidenceSummary = supportStrength >= 1 ? "Company profile/support document evidence is available." : "Company profile evidence is missing.";
      evidenceType = supportStrength >= 1 ? "COMPANY_DOCUMENT" : "UNMAPPED";
      evidenceSource = supportStrength >= 1 ? "Company profile/support documents" : "No company profile found";
      evidenceReference = profileDocument?.originalFileName;
    } else if (isProposalResponseRequirement(req.requirementType)) {
      supportStrength = requirementDocument || selectedEvidenceCount > 0 ? 1 : 0.65;
      supportStatus = supportStrength >= 1 ? "SUPPORTED" : "PARTIAL";
      evidenceSummary = requirementDocument || selectedEvidenceCount > 0
        ? `${requirementDocument ? "1 relevant Company Vault document" : "No relevant Company Vault document"}, ${selectedExperts.length} selected expert(s), ${selectedProjects.length} selected project reference(s), and generated response sections can support this proposal-response requirement.`
        : "The proposal generator can write this response section, but no supporting company evidence is mapped yet.";
      evidenceType = requirementDocument || selectedEvidenceCount > 0 ? "PROPOSAL_RESPONSE" : "UNMAPPED";
      evidenceSource = requirementDocument || selectedEvidenceCount > 0 ? "Generated proposal response + relevant Company Vault evidence" : "Generated response only; no Company Vault evidence matched";
      evidenceReference = requirementDocument?.originalFileName ?? selectedExperts[0]?.expertId ?? selectedProjects[0]?.projectId;
    } else {
      supportStrength = requirementDocument || selectedEvidenceCount > 0 ? 0.9 : 0.55;
      supportStatus = supportStrength >= 0.9 ? "SUPPORTED" : "PARTIAL";
      evidenceSummary = requirementDocument || selectedEvidenceCount > 0
        ? `${requirementDocument ? "A relevant Company Vault document" : "Selected expert/project evidence"} and generated response sections can support this strategic requirement.`
        : "No mapped company evidence yet; proposal narrative can be drafted but should be verified.";
      evidenceType = requirementDocument ? "COMPANY_DOCUMENT" : selectedEvidenceCount > 0 ? "SELECTED_COMPANY_EVIDENCE" : "UNMAPPED";
      evidenceSource = requirementDocument ? "Relevant Company Vault document + generated response" : selectedEvidenceCount > 0 ? "Selected Company Vault expert/project evidence + generated response" : "Generated response only";
      evidenceReference = requirementDocument?.originalFileName ?? selectedExperts[0]?.expertId ?? selectedProjects[0]?.projectId;
    }

    matrices.push({
      requirementTitle: req.title,
      requirementId: item.id,
      supportStatus,
      supportStrength,
      evidenceSummary,
      evidenceType,
      evidenceSource,
      evidenceReference,
      notes: req.priority === "MANDATORY" && supportStrength < 1 ? "Senior review required; generation is allowed when proposal response/evidence exists." : undefined,
    });

    if (req.priority === "MANDATORY" && supportStrength < 0.5) {
      gaps.push({
        requirementId: item.id,
        severity: nonCriticalRequirement(req.requirementType) ? "HIGH" : "CRITICAL",
        title: `${req.title} — evidence gap`,
        description: `${req.description} Current evidence status: ${supportStatus}. ${evidenceSummary}`,
        mitigationPlan: "Upload evidence, review matching candidates, or confirm manual proposal coverage before export.",
      });
    } else if (req.priority === "MANDATORY" && supportStrength < 0.9 && !nonCriticalRequirement(req.requirementType)) {
      gaps.push({
        requirementId: item.id,
        severity: "MEDIUM",
        title: `${req.title} — senior review needed`,
        description: `${req.description} Evidence exists but should be reviewed before final submission. ${evidenceSummary}`,
        mitigationPlan: "Review candidate evidence and mark final records as selected/reviewed.",
      });
    }
  }

  if (knowledge.experts.length === 0) gaps.push({ severity: "MEDIUM", title: "Expert library is empty", description: "No expert records in company vault. The matching engine has no personnel to recommend.", mitigationPlan: "Add expert profiles and upload CVs in the company vault." });
  if (knowledge.projects.length === 0) gaps.push({ severity: "MEDIUM", title: "No project references", description: "No project reference records in company vault.", mitigationPlan: "Add past project entries with sector, description, and contract value." });

  return { matrices, gaps };
}
