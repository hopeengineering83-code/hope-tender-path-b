import { safeParse, safeParseJsonArray } from "./safe-json-util";
import { prisma } from "../prisma";
import { checkHighValueClaimEvidence } from "./claim-evidence-coverage";

type Severity = "HIGH" | "MEDIUM" | "LOW";

type Finding = {
  severity: Severity;
  category: string;
  title: string;
  detail: string;
  nextAction: string;
};

export type ProposalEvidenceReadiness = {
  okForGeneration: boolean;
  score: number;
  requirementSummary: {
    total: number;
    withSourceTrace: number;
    mandatory: number;
    expert: number;
    projectExperience: number;
    technical: number;
    commercial: number;
  };
  evidenceSummary: {
    tenderFiles: number;
    tenderFilesWithExtractedText: number;
    companyDocuments: number;
    companyDocumentsExtracted: number;
    reviewedExpertsSelected: number;
    draftExpertsSelected: number;
    reviewedProjectsSelected: number;
    draftProjectsSelected: number;
    selectedExpertsWithSourceEvidence: number;
    selectedProjectsWithSourceEvidence: number;
    pricingWorkbookReady: boolean;
  };
  blockers: Finding[];
  warnings: Finding[];
  strengths: string[];
};

function parseArray(value: string | null | undefined): unknown[] {
  if (!value) return [];
  try {
    const parsed = safeParse(value, null);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function scoreFromFindings(blockers: Finding[], warnings: Finding[], strengths: string[]): number {
  const mediumWarnings = warnings.filter((w) => w.severity === "MEDIUM").length;
  const lowWarnings = warnings.filter((w) => w.severity === "LOW").length;
  const penalty = blockers.length * 18 + mediumWarnings * 6 + lowWarnings * 3;
  const bonus = Math.min(12, strengths.length * 2);
  return Math.max(0, Math.min(100, 78 + bonus - penalty));
}

export async function checkProposalEvidenceReadiness(tenderId: string, userId: string): Promise<ProposalEvidenceReadiness | null> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      files: { select: { id: true, extractedText: true } },
      requirements: true,
      expertMatches: { where: { isSelected: true }, include: { expert: { select: { id: true, fullName: true, trustLevel: true, profile: true, sourceDocumentId: true } } } },
      projectMatches: { where: { isSelected: true }, include: { project: { select: { id: true, name: true, trustLevel: true, summary: true, sourceDocumentId: true, evidences: { select: { id: true } } } } } },
    },
  });
  if (!tender) return null;

  const company = await prisma.company.findUnique({
    where: { userId },
    include: {
      documents: { select: { id: true, category: true, extractedText: true, aiExtractionStatus: true } },
      legalRecords: { select: { id: true } },
      financialRecords: { select: { id: true } },
      complianceRecords: { select: { id: true } },
    },
  });

  const pricingWorkbook = await prisma.pricingWorkbook.findUnique({ where: { tenderId }, include: { lines: true } }).catch(() => null);
  const blockers: Finding[] = [];
  const warnings: Finding[] = [];
  const strengths: string[] = [];

  const requirements = tender.requirements;
  const requirementSummary = {
    total: requirements.length,
    withSourceTrace: requirements.filter((r) => r.sourceExactQuote || r.sourcePageNumber || r.sourceTenderFileId).length,
    mandatory: requirements.filter((r) => /MANDATORY|CRITICAL|HIGH/i.test(`${r.priority} ${r.requirementType}`)).length,
    expert: requirements.filter((r) => /EXPERT|PERSONNEL|STAFF|CV/i.test(r.requirementType)).length,
    projectExperience: requirements.filter((r) => /PROJECT_EXPERIENCE|EXPERIENCE|REFERENCE|PAST/i.test(r.requirementType)).length,
    technical: requirements.filter((r) => /TECHNICAL|SCOPE|METHODOLOGY|DELIVERABLE/i.test(`${r.requirementType} ${r.title} ${r.description}`)).length,
    commercial: requirements.filter((r) => /FINANCIAL|PRICE|COMMERCIAL|COST/i.test(`${r.requirementType} ${r.title} ${r.description}`)).length,
  };

  const tenderFilesWithExtractedText = tender.files.filter((f) => (f.extractedText ?? "").trim().length > 100).length;
  const companyDocuments = company?.documents ?? [];
  const companyDocumentsExtracted = companyDocuments.filter((d) => (d.extractedText ?? "").trim().length > 100 || d.aiExtractionStatus === "EXTRACTED").length;
  const reviewedExperts = tender.expertMatches.filter((m) => m.expert.trustLevel === "REVIEWED");
  const draftExperts = tender.expertMatches.filter((m) => m.expert.trustLevel !== "REVIEWED");
  const reviewedProjects = tender.projectMatches.filter((m) => m.project.trustLevel === "REVIEWED");
  const draftProjects = tender.projectMatches.filter((m) => m.project.trustLevel !== "REVIEWED");
  const selectedExpertsWithSourceEvidence = reviewedExperts.filter((m) => Boolean(m.expert.sourceDocumentId) || (m.expert.profile ?? "").trim().length > 80).length;
  const selectedProjectsWithSourceEvidence = reviewedProjects.filter((m) => Boolean(m.project.sourceDocumentId) || m.project.evidences.length > 0 || (m.project.summary ?? "").trim().length > 80).length;
  const pricingWorkbookReady = Boolean(pricingWorkbook && pricingWorkbook.lines.length > 0 && pricingWorkbook.noPriceLeakage);

  const evidenceSummary = {
    tenderFiles: tender.files.length,
    tenderFilesWithExtractedText,
    companyDocuments: companyDocuments.length,
    companyDocumentsExtracted,
    reviewedExpertsSelected: reviewedExperts.length,
    draftExpertsSelected: draftExperts.length,
    reviewedProjectsSelected: reviewedProjects.length,
    draftProjectsSelected: draftProjects.length,
    selectedExpertsWithSourceEvidence,
    selectedProjectsWithSourceEvidence,
    pricingWorkbookReady,
  };

  if (tender.files.length === 0) blockers.push({ severity: "HIGH", category: "TENDER_EXTRACTION", title: "No tender files uploaded", detail: "The proposal cannot be generated against exact tender criteria without source tender files.", nextAction: "Upload tender/RFP files and run tender analysis." });
  else if (tenderFilesWithExtractedText === 0) blockers.push({ severity: "HIGH", category: "TENDER_EXTRACTION", title: "Tender files have no usable extracted text", detail: "Uploaded tender files exist, but extracted text is missing or too thin.", nextAction: "Re-extract tender files or upload machine-readable PDF/DOCX files." });
  else strengths.push(`${tenderFilesWithExtractedText} tender file(s) have usable extracted text.`);

  if (requirements.length === 0) blockers.push({ severity: "HIGH", category: "CRITERIA_EXTRACTION", title: "No tender requirements extracted", detail: "No structured requirements exist, so proposal sections cannot map to exact criteria.", nextAction: "Run tender analysis and review the extracted requirements." });
  else {
    strengths.push(`${requirements.length} tender requirement(s) are structured.`);
    const traceRatio = requirementSummary.withSourceTrace / Math.max(1, requirements.length);
    if (traceRatio < 0.6) warnings.push({ severity: "MEDIUM", category: "SOURCE_TRACEABILITY", title: "Weak requirement source traceability", detail: `${requirementSummary.withSourceTrace}/${requirements.length} requirements have page/file/quote references.`, nextAction: "Re-run analysis or manually add source references so proposal claims cite exact tender sections." });
    else strengths.push("Most requirements have source traceability.");
  }

  if (!company) blockers.push({ severity: "HIGH", category: "COMPANY_KNOWLEDGE", title: "Company profile is missing", detail: "The proposal cannot be grounded in company capability without company knowledge.", nextAction: "Complete company setup and upload company documents." });
  else {
    if (companyDocuments.length === 0) blockers.push({ severity: "HIGH", category: "COMPANY_DOCUMENTS", title: "No company documents uploaded", detail: "The engine needs company profile, CVs, project references, legal, financial, and compliance documents.", nextAction: "Upload and extract company documents before proposal generation." });
    else if (companyDocumentsExtracted === 0) blockers.push({ severity: "HIGH", category: "COMPANY_DOCUMENTS", title: "Company documents are not extracted", detail: "Company documents exist, but no usable extracted content is available.", nextAction: "Run company knowledge extraction/re-extraction." });
    else strengths.push(`${companyDocumentsExtracted} company document(s) have extracted evidence.`);

    if (!company.profileSummary || company.profileSummary.trim().length < 80) warnings.push({ severity: "MEDIUM", category: "COMPANY_PROFILE", title: "Company profile summary is weak", detail: "The company profile summary is missing or too short for strong positioning.", nextAction: "Review the company profile and add a source-grounded capability summary." });
    if (company.legalRecords.length === 0) warnings.push({ severity: "MEDIUM", category: "LEGAL_EVIDENCE", title: "No legal records found", detail: "Legal eligibility evidence is not structured in the knowledge base.", nextAction: "Add registration, tax, licence, and eligibility records when required." });
    if (company.financialRecords.length === 0) warnings.push({ severity: "LOW", category: "FINANCIAL_EVIDENCE", title: "No financial records found", detail: "Financial capacity evidence is not structured in the knowledge base.", nextAction: "Add audited turnover or capacity records if required by the tender." });
    if (company.complianceRecords.length === 0) warnings.push({ severity: "LOW", category: "COMPLIANCE_EVIDENCE", title: "No compliance records found", detail: "Compliance certifications are not structured in the knowledge base.", nextAction: "Add ISO, authority, or sector compliance records when applicable." });
  }

  if (requirementSummary.expert > 0) {
    if (tender.expertMatches.length === 0) blockers.push({ severity: "HIGH", category: "EXPERT_SELECTION", title: "No experts selected", detail: "The tender has expert/personnel criteria but no selected experts.", nextAction: "Run matching/rematch and select reviewed experts for each required role." });
    else if (reviewedExperts.length === 0) blockers.push({ severity: "HIGH", category: "EXPERT_REVIEW", title: "Selected experts are not reviewed", detail: "Experts are selected, but none are marked REVIEWED.", nextAction: "Review selected expert records against source CVs before generation." });
    else if (selectedExpertsWithSourceEvidence < reviewedExperts.length) warnings.push({ severity: "MEDIUM", category: "EXPERT_EVIDENCE", title: "Some reviewed experts lack source evidence", detail: `${selectedExpertsWithSourceEvidence}/${reviewedExperts.length} reviewed selected experts have source evidence or substantial profile.`, nextAction: "Attach source CV documents or strengthen reviewed expert profiles." });
    else strengths.push("Selected experts are reviewed and evidence-backed.");
  }

  if (requirementSummary.projectExperience > 0) {
    if (tender.projectMatches.length === 0) blockers.push({ severity: "HIGH", category: "PROJECT_SELECTION", title: "No project references selected", detail: "The tender has project-experience criteria but no selected project references.", nextAction: "Run matching/rematch and select reviewed projects that match the scope." });
    else if (reviewedProjects.length === 0) blockers.push({ severity: "HIGH", category: "PROJECT_REVIEW", title: "Selected projects are not reviewed", detail: "Projects are selected, but none are marked REVIEWED.", nextAction: "Review selected project references against source documents before generation." });
    else if (selectedProjectsWithSourceEvidence < reviewedProjects.length) warnings.push({ severity: "MEDIUM", category: "PROJECT_EVIDENCE", title: "Some reviewed projects lack source evidence", detail: `${selectedProjectsWithSourceEvidence}/${reviewedProjects.length} reviewed selected projects have source evidence or substantial summary.`, nextAction: "Attach completion certificates, testimonials, contracts, or strengthen project summaries." });
    else strengths.push("Selected projects are reviewed and evidence-backed.");
  }

  const claimEvidenceFindings = checkHighValueClaimEvidence({
    company,
    selectedReviewedExperts: reviewedExperts.map((m) => m.expert),
    selectedReviewedProjects: reviewedProjects.map((m) => m.project),
    tenderText: `${tender.title}\n${tender.description ?? ""}\n${tender.analysisSummary ?? ""}\n${requirements.map((r) => `${r.title}\n${r.description}`).join("\n")}`,
  });
  for (const finding of claimEvidenceFindings) {
    if (finding.severity === "HIGH") blockers.push(finding);
    else warnings.push(finding);
  }
  if (claimEvidenceFindings.length === 0 && companyDocumentsExtracted > 0) strengths.push("High-value company claim evidence coverage has no detected blocker.");

  if (parseArray(tender.exactFileNaming).length > 0 || parseArray(tender.exactFileOrder).length > 0) strengths.push("Submission file naming/order controls are captured.");
  else if (requirements.length > 0) warnings.push({ severity: "LOW", category: "SUBMISSION_CONTROLS", title: "No exact file naming/order controls captured", detail: "Final export may miss exact packaging rules if the tender contains them.", nextAction: "Confirm whether the tender defines file names, envelope names, or document order." });

  if (requirementSummary.commercial > 0 && !pricingWorkbookReady) warnings.push({ severity: "MEDIUM", category: "PRICING_READINESS", title: "Commercial criteria exist but pricing workbook is incomplete", detail: "The tender appears to include commercial criteria, but pricing is incomplete or price leakage is not confirmed.", nextAction: "Complete the pricing workbook and confirm no technical-envelope price leakage." });

  const score = scoreFromFindings(blockers, warnings, strengths);
  return { okForGeneration: blockers.length === 0, score, requirementSummary, evidenceSummary, blockers, warnings, strengths };
}
