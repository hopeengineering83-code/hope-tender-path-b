import type { CompanyKnowledgeSnapshot, ComplianceResult, MatchingResult, RequirementDraft } from "./types";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hasSupportDocument(knowledge: CompanyKnowledgeSnapshot, patterns: RegExp[]): boolean {
  return knowledge.documents.some((doc) => {
    const text = `${doc.category} ${doc.originalFileName} ${doc.extractedText ?? ""}`;
    return patterns.some((pattern) => pattern.test(text));
  });
}

function nonCriticalRequirement(type: string): boolean {
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
  const documentCount = knowledge.documents.length;
  const legalCount = knowledge.legalRecords.length || (hasSupportDocument(knowledge, [/LEGAL_REGISTRATION/i, /registration/i, /license/i, /licence/i, /certificate/i, /tin/i, /vat/i]) ? 1 : 0);
  const financialCount = knowledge.financialRecords.length || (hasSupportDocument(knowledge, [/FINANCIAL_STATEMENT/i, /audit/i, /financial/i, /turnover/i, /balance/i]) ? 1 : 0);
  const complianceCount = knowledge.complianceRecords.length || (hasSupportDocument(knowledge, [/CERTIFICATION/i, /COMPLIANCE_RECORD/i, /MANUAL/i, /declaration/i, /certificate/i, /policy/i, /manual/i]) ? 1 : 0);
  const companyProfileCount = hasSupportDocument(knowledge, [/COMPANY_PROFILE/i, /company profile/i, /service lines/i, /consultancy/i]) ? 1 : 0;

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

    if (req.requirementType === "EXPERT") {
      const denominator = Math.max(req.requiredQuantity || 1, 1);
      const strongSelected = selectedExperts.length;
      const seniorRelevant = highScoringExperts.length;
      supportStrength = expertCount > 0 ? clamp01(Math.max(strongSelected / denominator, seniorRelevant > 0 ? 0.72 : 0)) : 0;
      supportStatus = strongSelected >= denominator ? "SUPPORTED" : supportStrength >= 0.7 ? "EVIDENCE_PENDING_REVIEW" : supportStrength > 0 ? "PARTIAL" : "UNSUPPORTED";
      evidenceSummary = strongSelected > 0
        ? `${strongSelected} expert(s) selected from ${expertCount} expert record(s) using broad senior-consultant matching.`
        : `${seniorRelevant} expert candidate(s) scored 75%+ from ${expertCount} expert record(s); review/selection required if no candidate reaches 90%.`;
      evidenceType = "EXPERT";
      evidenceSource = strongSelected > 0 ? "Selected expert library" : "Expert library candidates";
      evidenceReference = (strongSelected > 0 ? selectedExperts : highScoringExperts).map((match) => match.expertId).slice(0, 3).join(", ") || undefined;
    } else if (req.requirementType === "PROJECT_EXPERIENCE") {
      const denominator = Math.max(req.requiredQuantity || 1, 1);
      const strongSelected = selectedProjects.length;
      const seniorRelevant = highScoringProjects.length;
      supportStrength = projectCount > 0 ? clamp01(Math.max(strongSelected / denominator, seniorRelevant > 0 ? 0.72 : 0)) : 0;
      supportStatus = strongSelected >= denominator ? "SUPPORTED" : supportStrength >= 0.7 ? "EVIDENCE_PENDING_REVIEW" : supportStrength > 0 ? "PARTIAL" : "UNSUPPORTED";
      evidenceSummary = strongSelected > 0
        ? `${strongSelected} project reference(s) selected from ${projectCount} available project record(s) using broad senior-consultant matching.`
        : `${seniorRelevant} project candidate(s) scored 75%+ from ${projectCount} available project record(s); review/selection required if no candidate reaches 90%.`;
      evidenceType = "PROJECT";
      evidenceSource = strongSelected > 0 ? "Selected project references" : "Project library candidates";
      evidenceReference = (strongSelected > 0 ? selectedProjects : highScoringProjects).map((match) => match.projectId).slice(0, 3).join(", ") || undefined;
    } else if (["LEGAL", "ELIGIBILITY", "REGISTRATION"].includes(req.requirementType)) {
      supportStrength = legalCount > 0 ? 1 : documentCount > 0 ? 0.65 : 0;
      supportStatus = supportStrength >= 1 ? "SUPPORTED" : supportStrength > 0 ? "EVIDENCE_PENDING_REVIEW" : "UNSUPPORTED";
      evidenceSummary = legalCount > 0
        ? `${legalCount} legal/company registration evidence source(s) available.`
        : documentCount > 0
          ? `${documentCount} company document(s) available for legal evidence review.`
          : "No legal/company registration evidence available yet.";
      evidenceType = "LEGAL_RECORD";
      evidenceSource = legalCount > 0 ? "Company legal/support documents" : "No legal records found";
      evidenceReference = knowledge.legalRecords[0]?.referenceNumber ?? knowledge.legalRecords[0]?.title ?? knowledge.documents.find((doc) => /LEGAL_REGISTRATION/i.test(doc.category))?.originalFileName;
    } else if (["FINANCIAL", "FINANCIAL_CAPACITY"].includes(req.requirementType)) {
      supportStrength = financialCount > 0 ? 1 : documentCount > 0 ? 0.65 : 0;
      supportStatus = supportStrength >= 1 ? "SUPPORTED" : supportStrength > 0 ? "EVIDENCE_PENDING_REVIEW" : "UNSUPPORTED";
      evidenceSummary = financialCount > 0
        ? `${financialCount} financial evidence source(s) available for internal evidence mapping.`
        : documentCount > 0
          ? `${documentCount} company document(s) available for financial evidence review.`
          : "No financial evidence available yet.";
      evidenceType = "FINANCIAL_RECORD";
      evidenceSource = financialCount > 0 ? "Company financial/support documents" : "No financial records found";
      evidenceReference = knowledge.financialRecords[0] ? `${knowledge.financialRecords[0].recordType} ${knowledge.financialRecords[0].fiscalYear}` : knowledge.documents.find((doc) => /FINANCIAL_STATEMENT/i.test(doc.category))?.originalFileName;
    } else if (["COMPLIANCE", "CERTIFICATION", "DECLARATION"].includes(req.requirementType)) {
      const strengthBase = complianceCount > 0 || documentCount > 0 ? 1 : 0;
      supportStrength = strengthBase;
      supportStatus = supportStrength >= 1 ? "SUPPORTED" : "UNSUPPORTED";
      evidenceSummary = complianceCount > 0
        ? `${complianceCount} compliance/certification/support evidence source(s) available.`
        : documentCount > 0
          ? `${documentCount} company document(s) available for manual compliance evidence mapping.`
          : "No compliance or supporting documents available yet.";
      evidenceType = complianceCount > 0 ? "COMPANY_COMPLIANCE_RECORD" : "COMPANY_DOCUMENT";
      evidenceSource = complianceCount > 0 ? "Company compliance/support documents" : documentCount > 0 ? "Company documents" : "No evidence found";
      evidenceReference = knowledge.complianceRecords[0]?.referenceNumber ?? knowledge.documents[0]?.originalFileName;
    } else if (req.requirementType === "COMPANY_PROFILE") {
      supportStrength = companyProfileCount > 0 || documentCount > 0 ? 1 : 0;
      supportStatus = supportStrength >= 1 ? "SUPPORTED" : "UNSUPPORTED";
      evidenceSummary = supportStrength >= 1 ? "Company profile/support document evidence is available." : "Company profile evidence is missing.";
      evidenceType = "COMPANY_DOCUMENT";
      evidenceSource = supportStrength >= 1 ? "Company profile/support documents" : "No company profile found";
      evidenceReference = knowledge.documents.find((doc) => /COMPANY_PROFILE/i.test(doc.category))?.originalFileName ?? knowledge.documents[0]?.originalFileName;
    } else {
      supportStrength = documentCount > 0 ? 0.8 : 0;
      supportStatus = supportStrength > 0 ? "EVIDENCE_PENDING_REVIEW" : "UNSUPPORTED";
      evidenceSummary = documentCount > 0
        ? `${documentCount} company document(s), selected experts/projects, and generated response sections can support this strategic requirement after senior review.`
        : "No company documents available yet.";
      evidenceType = "COMPANY_DOCUMENT";
      evidenceSource = documentCount > 0 ? "Company document library / generated response" : "No company documents found";
      evidenceReference = knowledge.documents[0]?.originalFileName;
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
      notes: req.priority === "MANDATORY" && supportStrength < 1 ? "Senior review required; not automatically treated as fatal unless evidence is absent." : undefined,
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

  if (knowledge.experts.length === 0) {
    gaps.push({
      severity: "MEDIUM",
      title: "Expert library is empty",
      description: "No expert records in company vault. The matching engine has no personnel to recommend.",
      mitigationPlan: "Add expert profiles and upload CVs in the company vault.",
    });
  }

  if (knowledge.projects.length === 0) {
    gaps.push({
      severity: "MEDIUM",
      title: "No project references",
      description: "No project reference records in company vault.",
      mitigationPlan: "Add past project entries with sector, description, and contract value.",
    });
  }

  return { matrices, gaps };
}
