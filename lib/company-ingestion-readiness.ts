import { prisma } from "./prisma";

function hasUsefulText(text: string | null | undefined): boolean {
  return (text ?? "").replace(/\s+/g, " ").trim().length >= 80;
}

function parseExpectedCount(text: string | null | undefined, pattern: RegExp): number | null {
  const match = (text ?? "").match(pattern)?.[1];
  if (!match) return null;
  const parsed = Number.parseInt(match, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function maxKnown(values: Array<number | null>): number | null {
  const numeric = values.filter((value): value is number => typeof value === "number" && value > 0);
  return numeric.length > 0 ? Math.max(...numeric) : null;
}

export type CompanyIngestionReadiness = {
  ingestionReady: boolean;
  blockers: string[];
  warnings: string[];
  totals: {
    documents: number;
    usefulDocuments: number;
    pendingDocuments: number;
    failedDocuments: number;
    experts: number;
    projects: number;
    reviewedExperts: number;
    reviewedProjects: number;
    legalRecords: number;
    financialRecords: number;
    complianceRecords: number;
    expectedExperts: number | null;
    expectedProjects: number | null;
    missingExperts: number;
    missingProjects: number;
  };
};

export async function getCompanyIngestionReadiness(companyId: string): Promise<CompanyIngestionReadiness> {
  const [company, docs, experts, projects, legalRecords, financialRecords, complianceRecords] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        legalName: true,
        description: true,
        profileSummary: true,
        serviceLines: true,
        sectors: true,
        licenseGrade: true,
        setupCompletedAt: true,
      },
    }),
    prisma.companyDocument.findMany({
      where: { companyId },
      select: { extractedText: true, aiExtractionStatus: true, aiExtractionError: true },
    }),
    prisma.expert.findMany({ where: { companyId, deletedAt: null }, select: { trustLevel: true } }),
    prisma.project.findMany({ where: { companyId, deletedAt: null }, select: { trustLevel: true } }),
    prisma.legalRecord.count({ where: { companyId } }),
    prisma.financialRecord.count({ where: { companyId } }),
    prisma.companyComplianceRecord.count({ where: { companyId } }),
  ]);

  const reviewedExperts = experts.filter((expert) => expert.trustLevel === "REVIEWED").length;
  const reviewedProjects = projects.filter((project) => project.trustLevel === "REVIEWED").length;
  const usefulDocuments = docs.filter((doc) => hasUsefulText(doc.extractedText)).length;
  const pendingDocuments = docs.filter((doc) => doc.aiExtractionStatus === "PENDING" || doc.aiExtractionStatus === "EXTRACTING").length;
  const failedDocuments = docs.filter((doc) => doc.aiExtractionStatus === "FAILED" || Boolean(doc.aiExtractionError)).length;

  const expectedExperts = maxKnown(docs.map((doc) => parseExpectedCount(doc.extractedText, /(\d{1,3})\s+(?:experts?|expert\s+cvs?|cvs?|staff|personnel)\b/i)));
  const expectedProjects = maxKnown(docs.map((doc) => parseExpectedCount(doc.extractedText, /(\d{1,3})\s+(?:selected\s+)?(?:similar\s+)?(?:projects?|assignments?|references?)\b/i)));
  const missingExperts = expectedExperts ? Math.max(0, expectedExperts - experts.length) : 0;
  const missingProjects = expectedProjects ? Math.max(0, expectedProjects - projects.length) : 0;

  const hasCompanyProfile = Boolean(
    company && (
      hasUsefulText(company.profileSummary)
      || hasUsefulText(company.description)
      || (company.legalName ?? "").trim().length > 0
      || (company.licenseGrade ?? "").trim().length > 0
      || (company.serviceLines ?? "[]") !== "[]"
      || (company.sectors ?? "[]") !== "[]"
      || company.setupCompletedAt
    ),
  );
  const hasAnyKnowledgeSource = Boolean(
    hasCompanyProfile
    || usefulDocuments > 0
    || reviewedExperts > 0
    || reviewedProjects > 0
    || legalRecords > 0
    || financialRecords > 0
    || complianceRecords > 0
  );

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!company) blockers.push("Company profile has not been created.");
  if (!hasAnyKnowledgeSource) blockers.push("No usable company knowledge source exists. Upload/review the company profile, CVs, project references, legal records, or financial records before generation.");
  if (docs.length > 0 && usefulDocuments === 0 && reviewedExperts === 0 && reviewedProjects === 0) blockers.push("Company documents are uploaded but no usable extracted knowledge or reviewed expert/project records are available yet.");
  if (pendingDocuments > 0 && usefulDocuments === 0 && reviewedExperts === 0 && reviewedProjects === 0) blockers.push("Company knowledge extraction is still pending. Re-import/review the company documents before generation.");

  if (reviewedExperts === 0) warnings.push("No REVIEWED experts are available. Expert-required tenders will be blocked until at least one relevant expert is reviewed.");
  if (reviewedProjects === 0) warnings.push("No REVIEWED projects are available. Project-experience tenders will be blocked until at least one relevant project is reviewed.");
  if (failedDocuments > 0) warnings.push(`${failedDocuments} company document(s) have failed extraction status and should be re-imported or replaced.`);
  if (missingExperts > 0) warnings.push(`Expert completeness gap: ${missingExperts} expected expert record(s) are not present in the knowledge vault.`);
  if (missingProjects > 0) warnings.push(`Project completeness gap: ${missingProjects} expected project record(s) are not present in the knowledge vault.`);

  return {
    ingestionReady: blockers.length === 0,
    blockers,
    warnings,
    totals: {
      documents: docs.length,
      usefulDocuments,
      pendingDocuments,
      failedDocuments,
      experts: experts.length,
      projects: projects.length,
      reviewedExperts,
      reviewedProjects,
      legalRecords,
      financialRecords,
      complianceRecords,
      expectedExperts,
      expectedProjects,
      missingExperts,
      missingProjects,
    },
  };
}
