import { prisma } from "../prisma";
import { checkHighValueClaimEvidence } from "./claim-evidence-coverage";
import { canUseVaultRecord, VAULT_REVIEW_CONSUMER_SELECT, type ReviewRecordState } from "../vault-review-provenance";

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
    /** Backward-compatible field names: counts runtime-authoritative selected evidence. */
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
    const parsed = JSON.parse(value);
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
      expertMatches: {
        where: { isSelected: true },
        include: {
          expert: {
            select: {
              ...VAULT_REVIEW_CONSUMER_SELECT.EXPERT,
              id: true,
              profile: true,
            },
          },
        },
      },
      projectMatches: {
        where: { isSelected: true },
        include: {
          project: {
            select: {
              ...VAULT_REVIEW_CONSUMER_SELECT.PROJECT,
              id: true,
              summary: true,
              evidences: { select: { id: true } },
            },
          },
        },
      },
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

  // Runtime authority is canonical here. A durable SOURCE_VERIFIED record is
  // equally eligible with an authenticated human REVIEWED record; neither path
  // may be reduced to a raw trustLevel string check. This is the generation
  // counterpart of the Engine's matching eligibility rule.
  const authoritativeExperts = tender.expertMatches.filter((m) => canUseVaultRecord(m.expert as ReviewRecordState, "GENERATION"));
  const draftExperts = tender.expertMatches.filter((m) => !canUseVaultRecord(m.expert as ReviewRecordState, "GENERATION"));
  const authoritativeProjects = tender.projectMatches.filter((m) => canUseVaultRecord(m.project as ReviewRecordState, "GENERATION"));
  const draftProjects = tender.projectMatches.filter((m) => !canUseVaultRecord(m.project as ReviewRecordState, "GENERATION"));
  const selectedExpertsWithSourceEvidence = authoritativeExperts.filter((m) => Boolean(m.expert.sourceDocumentId) || (m.expert.profile ?? "").trim().length > 80).length;
  const selectedProjectsWithSourceEvidence = authoritativeProjects.filter((m) => Boolean(m.project.sourceDocumentId) || m.project.evidences.length > 0 || (m.project.summary ?? "").trim().length > 80).length;
  const pricingWorkbookReady = Boolean(pricingWorkbook && pricingWorkbook.lines.length > 0 && pricingWorkbook.noPriceLeakage);

  const evidenceSummary = {
    tenderFiles: tender.files.length,
    tenderFilesWithExtractedText,
    companyDocuments: companyDocuments.length,
    companyDocumentsExtracted,
    reviewedExpertsSelected: authoritativeExperts.length,
    draftExpertsSelected: draftExperts.length,
    reviewedProjectsSelected: authoritativeProjects.length,
    draftProjectsSelected: draftProjects.length,
    selectedExpertsWithSourceEvidence,
    selectedProjectsWithSourceEvidence,
    pricingWorkbookReady,
  };

  if (tender.files.length === 0) blockers.push({ severity: "HIGH", category: "TENDER_EXTRACTION", title: "No tender files uploaded", detail: "The proposal cannot be generated against exact tender criteria without source tender files.", nextAction: "Upload tender/RFP files and run tender analysis." });
  else if (tenderFilesWithExtractedText === 0) blockers.push({ severity: "HIGH", category: "TENDER_EXTRACTION", title: "Tender files have no usable extracted text", detail: "Uploaded tender files exist, but extracted text is missing or too thin.", nextAction: "Re-extract tender files or upload machine-readable PDF/DOCX files." });
  else strengths.push(`${tenderFilesWithExtractedText} tender file(s) have usable extracted text.`);

  if (requirements.length === 0) blockers.push({ severity: "HIGH", category: "CRITERIA_EXTRACTION", title: "No tender requirements extracted", detail: "No structured requirements exist, so proposal sections cannot map to exact criteria.", nextAction: "Run AI Analyze against the current tender sources." });
  else {
    strengths.push(`${requirements.length} tender requirement(s) are structured.`);
    const traceRatio = requirementSummary.withSourceTrace / Math.max(1, requirements.length);
    if (traceRatio < 0.6) warnings.push({ severity: "MEDIUM", category: "SOURCE_TRACEABILITY", title: "Weak requirement source traceability", detail: `${requirementSummary.withSourceTrace}/${requirements.length} requirements have page/file/quote references.`, nextAction: "Re-run AI Analyze after correcting the tender source/extraction if the current source grounding is incomplete." });
    else strengths.push("Most requirements have source traceability.");
  }

  if (!company) blockers.push({ severity: "HIGH", category: "COMPANY_KNOWLEDGE", title: "Company profile is missing", detail: "The proposal cannot be grounded in company capability without company knowledge.", nextAction: "Complete company setup and upload company documents." });
  else {
    if (companyDocuments.length === 0) blockers.push({ severity: "HIGH", category: "COMPANY_DOCUMENTS", title: "No company documents uploaded", detail: "The Engine needs genuine company profile, CV, project-reference, legal, financial, and compliance source evidence.", nextAction: "Upload the missing company source documents; ingestion and verification are automatic." });
    else if (companyDocumentsExtracted === 0) blockers.push({ severity: "HIGH", category: "COMPANY_DOCUMENTS", title: "Company documents are not extracted", detail: "Company documents exist, but no usable extracted content is available.", nextAction: "Allow automatic Vault ingestion to retry; replace the source only if extraction remains unusable." });
    else strengths.push(`${companyDocumentsExtracted} company document(s) have extracted evidence.`);

    if (!company.profileSummary || company.profileSummary.trim().length < 80) warnings.push({ severity: "MEDIUM", category: "COMPANY_PROFILE", title: "Company profile summary is weak", detail: "The company profile summary is missing or too short for strong positioning.", nextAction: "Add genuine company-profile source evidence if stronger positioning is needed." });
    if (company.legalRecords.length === 0) warnings.push({ severity: "MEDIUM", category: "LEGAL_EVIDENCE", title: "No legal records found", detail: "Legal eligibility evidence is not structured in the knowledge base.", nextAction: "Upload registration, tax, licence, and eligibility source documents when required." });
    if (company.financialRecords.length === 0) warnings.push({ severity: "LOW", category: "FINANCIAL_EVIDENCE", title: "No financial records found", detail: "Financial capacity evidence is not structured in the knowledge base.", nextAction: "Upload audited turnover/capacity source evidence if required by the tender." });
    if (company.complianceRecords.length === 0) warnings.push({ severity: "LOW", category: "COMPLIANCE_EVIDENCE", title: "No compliance records found", detail: "Compliance certifications are not structured in the knowledge base.", nextAction: "Upload authority/sector compliance source evidence when applicable." });
  }

  if (requirementSummary.expert > 0) {
    if (tender.expertMatches.length === 0) blockers.push({ severity: "HIGH", category: "EXPERT_SELECTION", title: "No experts selected", detail: "The tender has expert/personnel criteria but no selected experts.", nextAction: "Run Engine; it reconciles the Vault and selects the strongest eligible source-backed experts automatically." });
    else if (authoritativeExperts.length === 0) blockers.push({ severity: "HIGH", category: "EXPERT_EVIDENCE", title: "Selected experts lack authoritative source evidence", detail: "Experts are selected, but none has durable REVIEWED or SOURCE_VERIFIED provenance.", nextAction: "Upload the missing genuine CV source evidence; no approval or promotion click is required after automatic verification." });
    else if (selectedExpertsWithSourceEvidence < authoritativeExperts.length) warnings.push({ severity: "MEDIUM", category: "EXPERT_EVIDENCE", title: "Some authoritative experts have weak source payloads", detail: `${selectedExpertsWithSourceEvidence}/${authoritativeExperts.length} authoritative selected experts have a bound source document or substantial profile.`, nextAction: "Add stronger genuine CV source evidence for the affected records." });
    else strengths.push("Selected experts have authoritative source-backed provenance.");
  }

  if (requirementSummary.projectExperience > 0) {
    if (tender.projectMatches.length === 0) blockers.push({ severity: "HIGH", category: "PROJECT_SELECTION", title: "No project references selected", detail: "The tender has project-experience criteria but no selected project references.", nextAction: "Run Engine; it reconciles the Vault and selects the strongest eligible source-backed projects automatically." });
    else if (authoritativeProjects.length === 0) blockers.push({ severity: "HIGH", category: "PROJECT_EVIDENCE", title: "Selected projects lack authoritative source evidence", detail: "Projects are selected, but none has durable REVIEWED or SOURCE_VERIFIED provenance.", nextAction: "Upload the missing genuine project-reference source evidence; no approval or promotion click is required after automatic verification." });
    else if (selectedProjectsWithSourceEvidence < authoritativeProjects.length) warnings.push({ severity: "MEDIUM", category: "PROJECT_EVIDENCE", title: "Some authoritative projects have weak source payloads", detail: `${selectedProjectsWithSourceEvidence}/${authoritativeProjects.length} authoritative selected projects have a bound source document, evidence row, or substantial summary.`, nextAction: "Add stronger genuine contract/reference/completion source evidence for the affected records." });
    else strengths.push("Selected projects have authoritative source-backed provenance.");
  }

  const claimEvidenceFindings = checkHighValueClaimEvidence({
    company,
    // These argument names are historical. The arrays now contain every
    // runtime-authoritative selected record, including SOURCE_VERIFIED.
    selectedReviewedExperts: authoritativeExperts.map((m) => m.expert),
    selectedReviewedProjects: authoritativeProjects.map((m) => m.project),
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