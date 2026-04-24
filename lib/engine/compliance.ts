import type { CompanyKnowledgeSnapshot, ComplianceResult, MatchingResult, RequirementDraft } from "./types";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function buildCompliance(
  requirementIds: Array<{ id: string; requirement: RequirementDraft }>,
  knowledge: CompanyKnowledgeSnapshot,
  matching: MatchingResult,
): ComplianceResult {
  const selectedExperts = matching.expertMatches.filter((match) => match.isSelected);
  const selectedProjects = matching.projectMatches.filter((match) => match.isSelected);

  const expertCount = knowledge.experts.length;
  const projectCount = knowledge.projects.length;
  const documentCount = knowledge.documents.length;
  const legalCount = knowledge.legalRecords.length;
  const financialCount = knowledge.financialRecords.length;
  const complianceCount = knowledge.complianceRecords.length;

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
      supportStrength = expertCount > 0 ? clamp01(selectedExperts.length / Math.max(req.requiredQuantity || 1, 1)) : 0;
      supportStatus = supportStrength >= 1 ? "SUPPORTED" : supportStrength > 0 ? "PARTIAL" : "UNSUPPORTED";
      evidenceSummary = `${selectedExperts.length} expert(s) selected from ${expertCount} expert record(s) in company knowledge.`;
      evidenceType = "EXPERT";
      evidenceSource = selectedExperts.length > 0 ? "Selected expert library" : "Expert library";
      evidenceReference = selectedExperts.map((match) => match.expertId).slice(0, 3).join(", ") || undefined;
    } else if (req.requirementType === "PROJECT_EXPERIENCE") {
      supportStrength = projectCount > 0 ? clamp01(selectedProjects.length / Math.max(req.requiredQuantity || 1, 1)) : 0;
      supportStatus = supportStrength >= 1 ? "SUPPORTED" : supportStrength > 0 ? "PARTIAL" : "UNSUPPORTED";
      evidenceSummary = `${selectedProjects.length} project reference(s) selected from ${projectCount} available project record(s).`;
      evidenceType = "PROJECT";
      evidenceSource = selectedProjects.length > 0 ? "Selected project references" : "Project library";
      evidenceReference = selectedProjects.map((match) => match.projectId).slice(0, 3).join(", ") || undefined;
    } else if (["LEGAL", "ELIGIBILITY", "REGISTRATION"].includes(req.requirementType)) {
      supportStrength = legalCount > 0 ? 1 : 0;
      supportStatus = supportStrength >= 1 ? "SUPPORTED" : "UNSUPPORTED";
      evidenceSummary = legalCount > 0
        ? `${legalCount} legal/company registration record(s) available.`
        : "No legal/company registration records available yet.";
      evidenceType = "LEGAL_RECORD";
      evidenceSource = legalCount > 0 ? "Company legal records" : "No legal records found";
      evidenceReference = knowledge.legalRecords[0]?.referenceNumber ?? knowledge.legalRecords[0]?.title;
    } else if (["FINANCIAL", "FINANCIAL_CAPACITY"].includes(req.requirementType)) {
      supportStrength = financialCount > 0 ? 1 : 0;
      supportStatus = supportStrength >= 1 ? "SUPPORTED" : "UNSUPPORTED";
      evidenceSummary = financialCount > 0
        ? `${financialCount} financial record(s) available for internal evidence mapping.`
        : "No financial records available yet.";
      evidenceType = "FINANCIAL_RECORD";
      evidenceSource = financialCount > 0 ? "Company financial records" : "No financial records found";
      evidenceReference = knowledge.financialRecords[0] ? `${knowledge.financialRecords[0].recordType} ${knowledge.financialRecords[0].fiscalYear}` : undefined;
    } else if (["COMPLIANCE", "CERTIFICATION", "DECLARATION"].includes(req.requirementType)) {
      const strengthBase = complianceCount > 0 || documentCount > 0 ? 1 : 0;
      supportStrength = strengthBase;
      supportStatus = supportStrength >= 1 ? "SUPPORTED" : "UNSUPPORTED";
      evidenceSummary = complianceCount > 0
        ? `${complianceCount} compliance/certification record(s) available.`
        : documentCount > 0
          ? `${documentCount} company document(s) available for manual compliance evidence mapping.`
          : "No compliance or supporting documents available yet.";
      evidenceType = complianceCount > 0 ? "COMPANY_COMPLIANCE_RECORD" : "COMPANY_DOCUMENT";
      evidenceSource = complianceCount > 0 ? "Company compliance records" : documentCount > 0 ? "Company documents" : "No evidence found";
      evidenceReference = knowledge.complianceRecords[0]?.referenceNumber ?? knowledge.documents[0]?.originalFileName;
    } else {
      supportStrength = documentCount > 0 ? 0.65 : 0;
      supportStatus = supportStrength > 0 ? "EVIDENCE_PENDING_REVIEW" : "UNSUPPORTED";
      evidenceSummary = documentCount > 0
        ? `${documentCount} company document(s) available for internal evidence mapping.`
        : "No company documents available yet.";
      evidenceType = "COMPANY_DOCUMENT";
      evidenceSource = documentCount > 0 ? "Company document library" : "No company documents found";
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
      notes: req.priority === "MANDATORY" && supportStrength < 1 ? "Needs stronger support before export." : undefined,
    });

    if (req.priority === "MANDATORY" && supportStrength < 0.5) {
      gaps.push({
        requirementId: item.id,
        severity: supportStrength === 0 ? "CRITICAL" : "HIGH",
        title: `${req.title} — insufficient evidence`,
        description: `${req.description} Current evidence status: ${supportStatus}. ${evidenceSummary}`,
        mitigationPlan: "Upload matching company documents or add expert/project records before export.",
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
