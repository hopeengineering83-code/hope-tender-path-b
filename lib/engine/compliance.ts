import type { CompanyKnowledgeSnapshot, ComplianceResult, MatchingResult, RequirementDraft } from "./types";

// Category → requirement type mapping for evidence scoring
const CATEGORY_TYPE_MAP: Record<string, string[]> = {
  EXPERT_CV:            ["EXPERT"],
  PROJECT_REFERENCE:    ["PROJECT_EXPERIENCE"],
  PROJECT_CONTRACT:     ["PROJECT_EXPERIENCE"],
  FINANCIAL_STATEMENT:  ["FINANCIAL", "ELIGIBILITY"],
  LEGAL_REGISTRATION:   ["ELIGIBILITY"],
  CERTIFICATION:        ["ELIGIBILITY", "TECHNICAL"],
  COMPANY_PROFILE:      ["COMPANY_PROFILE", "TECHNICAL"],
  COMPLIANCE_RECORD:    ["ELIGIBILITY", "DECLARATION"],
  MANUAL:               ["METHODOLOGY", "TECHNICAL"],
  PORTFOLIO:            ["PROJECT_EXPERIENCE", "COMPANY_PROFILE"],
  OTHER:                ["TECHNICAL"],
};

function docCoverageScore(
  reqType: string,
  reqDescription: string,
  documents: NonNullable<CompanyKnowledgeSnapshot["documents"]>,
): { score: number; summary: string } {
  const relevant = documents.filter((d) => {
    const covered = CATEGORY_TYPE_MAP[d.category] ?? ["OTHER"];
    return covered.includes(reqType);
  });
  if (relevant.length === 0) return { score: 0, summary: "No matching company documents." };

  // Text overlap score between req description and document extracted text
  const reqWords = new Set(reqDescription.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  let bestOverlap = 0;
  for (const doc of relevant) {
    const docWords = (doc.extractedText ?? doc.originalFileName)
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3);
    let hits = 0;
    for (const w of docWords) { if (reqWords.has(w)) hits++; }
    const overlap = reqWords.size > 0 ? hits / reqWords.size : 0;
    if (overlap > bestOverlap) bestOverlap = overlap;
  }

  const baseScore = Math.min(0.9, 0.4 + bestOverlap * 0.5);
  const names = relevant.map((d) => d.originalFileName).slice(0, 2).join(", ");
  return {
    score: baseScore,
    summary: `${relevant.length} document(s) available: ${names}.${bestOverlap > 0.1 ? " Content overlap detected." : ""}`,
  };
}

export function buildCompliance(
  requirementIds: Array<{ id: string; requirement: RequirementDraft }>,
  knowledge: CompanyKnowledgeSnapshot,
  matching: MatchingResult,
): ComplianceResult {
  const expertCount = knowledge.experts.length;
  const projectCount = knowledge.projects.length;
  const docs = knowledge.documents ?? [];

  const matrices: ComplianceResult["matrices"] = [];
  const gaps: ComplianceResult["gaps"] = [];

  for (const item of requirementIds) {
    const req = item.requirement;
    let supportStrength = 0;
    let supportStatus = "UNSUPPORTED";
    let evidenceSummary = "No mapped company evidence yet.";

    if (req.requirementType === "EXPERT") {
      const needed = req.requiredQuantity ?? 1;
      const selected = matching.expertMatches.filter((m) => m.isSelected).length;
      supportStrength = expertCount > 0 ? Math.min(1, selected / needed) : 0;
      supportStatus = supportStrength >= 1 ? "SUPPORTED" : supportStrength > 0 ? "PARTIAL" : "UNSUPPORTED";
      evidenceSummary = `${selected} of ${needed} required expert(s) matched. ${expertCount} total experts in vault.`;
    } else if (req.requirementType === "PROJECT_EXPERIENCE") {
      const needed = req.requiredQuantity ?? 1;
      const selected = matching.projectMatches.filter((m) => m.isSelected).length;
      supportStrength = projectCount > 0 ? Math.min(1, selected / needed) : 0;
      supportStatus = supportStrength >= 1 ? "SUPPORTED" : supportStrength > 0 ? "PARTIAL" : "UNSUPPORTED";
      evidenceSummary = `${selected} of ${needed} required project reference(s) matched. ${projectCount} total in vault.`;
    } else {
      const { score, summary } = docCoverageScore(req.requirementType, req.description, docs);
      supportStrength = score;
      supportStatus = score >= 0.8 ? "SUPPORTED" : score > 0 ? "EVIDENCE_PENDING_REVIEW" : "UNSUPPORTED";
      evidenceSummary = summary;
    }

    matrices.push({
      requirementTitle: req.title,
      requirementId: item.id,
      supportStatus,
      supportStrength,
      evidenceSummary,
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

  // Global gaps
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
