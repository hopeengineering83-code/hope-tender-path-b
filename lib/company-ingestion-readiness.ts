import type { PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { isDurablyReviewed, VAULT_REVIEW_CONSUMER_SELECT } from "./vault-review-provenance";

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

type ReadinessDoc = { extractedText: string | null; aiExtractionStatus?: string | null; aiExtractionError?: string | null };
type ReadinessExpert = { trustLevel: string | null; durableReview?: boolean };
type ReadinessProject = { trustLevel: string | null; durableReview?: boolean };

export type IngestionReadinessSnapshot = {
  docs: ReadinessDoc[];
  experts: ReadinessExpert[];
  projects: ReadinessProject[];
};

export type IngestionReadinessOptions = {
  requireDocuments?: boolean;
  requireReviewedExperts?: boolean;
  requireReviewedProjects?: boolean;
};

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

function isUsableReviewedRecord(record: ReadinessExpert | ReadinessProject): boolean {
  // Pure/unit callers may provide only trustLevel. Runtime DB callers also
  // provide durableReview, which is authoritative and prevents the UI from
  // advertising legacy REVIEWED rows that Engine must reject for missing
  // source-document provenance or byte integrity.
  return record.durableReview ?? record.trustLevel === "REVIEWED";
}

function hasRuntimeReviewAuthorityShape(record: unknown): boolean {
  // VAULT_REVIEW_CONSUMER_SELECT always includes sourceDocumentId, even when
  // its value is null. Its presence therefore distinguishes a real Prisma
  // authority record from a deliberately minimal pure/unit client record.
  // Runtime records always use the durable provenance validator; only callers
  // that omit the authority shape entirely retain the documented trust-level
  // fallback used by assessCompanyIngestionReadiness.
  return Boolean(
    record &&
      typeof record === "object" &&
      Object.prototype.hasOwnProperty.call(record, "sourceDocumentId"),
  );
}

export function assessCompanyIngestionReadiness(snapshot: IngestionReadinessSnapshot, opts: IngestionReadinessOptions = {}): CompanyIngestionReadiness {
  const requireReviewedExperts = opts.requireReviewedExperts !== false;
  const requireReviewedProjects = opts.requireReviewedProjects !== false;

  const reviewedExperts = snapshot.experts.filter(isUsableReviewedRecord).length;
  const reviewedProjects = snapshot.projects.filter(isUsableReviewedRecord).length;
  const usefulDocuments = snapshot.docs.filter((doc) => hasUsefulText(doc.extractedText)).length;
  const pendingDocuments = snapshot.docs.filter((doc) => doc.aiExtractionStatus === "PENDING" || doc.aiExtractionStatus === "EXTRACTING").length;
  const failedDocuments = snapshot.docs.filter((doc) => doc.aiExtractionStatus === "FAILED" || Boolean(doc.aiExtractionError)).length;

  const expectedExperts = maxKnown(snapshot.docs.map((doc) => parseExpectedCount(doc.extractedText, /(\d{1,3})\s+(?:experts?|expert\s+cvs?|cvs?|staff|personnel)\b/i)));
  const expectedProjects = maxKnown(snapshot.docs.map((doc) => parseExpectedCount(doc.extractedText, /(\d{1,3})\s+(?:selected\s+)?(?:similar\s+)?(?:projects?|assignments?|references?)\b/i)));
  const missingExperts = expectedExperts ? Math.max(0, expectedExperts - snapshot.experts.length) : 0;
  const missingProjects = expectedProjects ? Math.max(0, expectedProjects - snapshot.projects.length) : 0;

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (snapshot.docs.length > 0 && usefulDocuments === 0 && reviewedExperts === 0 && reviewedProjects === 0) blockers.push("Company documents are uploaded but no usable extracted knowledge or source-verified reviewed expert/project records are available yet.");
  if (pendingDocuments > 0 && usefulDocuments === 0 && reviewedExperts === 0 && reviewedProjects === 0) blockers.push("Company knowledge extraction is still pending. Re-import/review the company documents before generation.");
  if (requireReviewedExperts && reviewedExperts === 0) blockers.push("No source-verified reviewed experts are available.");
  if (requireReviewedProjects && reviewedProjects === 0) blockers.push("No source-verified reviewed projects are available.");

  if (reviewedExperts === 0) warnings.push("No source-verified reviewed experts are available. Expert-required tenders remain blocked until at least one relevant CV record is reviewed against a verified source document.");
  if (reviewedProjects === 0) warnings.push("No source-verified reviewed projects are available. Project-experience tenders remain blocked until at least one relevant project record is reviewed against a verified source document.");
  if (failedDocuments > 0) warnings.push(`${failedDocuments} company document(s) have failed extraction status and should be re-imported or replaced.`);
  if (missingExperts > 0) warnings.push(`Expert completeness gap: ${missingExperts} expected expert record(s) are not present in the knowledge vault.`);
  if (missingProjects > 0) warnings.push(`Project completeness gap: ${missingProjects} expected project record(s) are not present in the knowledge vault.`);

  return {
    ingestionReady: blockers.length === 0,
    blockers,
    warnings,
    totals: {
      documents: snapshot.docs.length,
      usefulDocuments,
      pendingDocuments,
      failedDocuments,
      experts: snapshot.experts.length,
      projects: snapshot.projects.length,
      reviewedExperts,
      reviewedProjects,
      legalRecords: 0,
      financialRecords: 0,
      complianceRecords: 0,
      expectedExperts,
      expectedProjects,
      missingExperts,
      missingProjects,
    },
  };
}

export async function getCompanyIngestionReadiness(companyId: string, opts: IngestionReadinessOptions = {}, client: PrismaClient = prisma): Promise<CompanyIngestionReadiness> {
  const [company, docs, expertRecords, projectRecords, legalRecords, financialRecords, complianceRecords] = await Promise.all([
    client.company.findUnique({
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
    client.companyDocument.findMany({
      where: { companyId },
      select: { extractedText: true, aiExtractionStatus: true, aiExtractionError: true },
    }),
    client.expert.findMany({ where: { companyId, deletedAt: null }, select: VAULT_REVIEW_CONSUMER_SELECT.EXPERT }),
    client.project.findMany({ where: { companyId, deletedAt: null }, select: VAULT_REVIEW_CONSUMER_SELECT.PROJECT }),
    client.legalRecord.count({ where: { companyId } }),
    client.financialRecord.count({ where: { companyId } }),
    client.companyComplianceRecord.count({ where: { companyId } }),
  ]);

  const experts: ReadinessExpert[] = expertRecords.map((record) => ({
    trustLevel: record.trustLevel,
    durableReview: hasRuntimeReviewAuthorityShape(record) ? isDurablyReviewed(record) : undefined,
  }));
  const projects: ReadinessProject[] = projectRecords.map((record) => ({
    trustLevel: record.trustLevel,
    durableReview: hasRuntimeReviewAuthorityShape(record) ? isDurablyReviewed(record) : undefined,
  }));

  const hasUsefulTextFn = (text: string | null | undefined): boolean => hasUsefulText(text);
  const hasCompanyProfile = Boolean(
    company && (
      hasUsefulTextFn(company.profileSummary)
      || hasUsefulTextFn(company.description)
      || (company.legalName ?? "").trim().length > 0
      || (company.licenseGrade ?? "").trim().length > 0
      || (company.serviceLines ?? "[]") !== "[]"
      || (company.sectors ?? "[]") !== "[]"
      || company.setupCompletedAt
    ),
  );
  const hasAnyKnowledgeSource = Boolean(
    hasCompanyProfile
    || docs.filter((doc) => hasUsefulTextFn(doc.extractedText)).length > 0
    || experts.some(isUsableReviewedRecord)
    || projects.some(isUsableReviewedRecord)
    || legalRecords > 0
    || financialRecords > 0
    || complianceRecords > 0
  );

  const result = assessCompanyIngestionReadiness({ docs, experts, projects }, opts);

  // Augment blockers from the full DB query that snapshot-based assess cannot see
  const extraBlockers: string[] = [];
  if (!company) extraBlockers.push("Company profile has not been created.");
  if (!hasAnyKnowledgeSource) extraBlockers.push("No usable company knowledge source exists. Upload/review the company profile, CVs, project references, legal records, or financial records before generation.");

  const mergedBlockers = [...extraBlockers, ...result.blockers];

  return {
    ...result,
    ingestionReady: mergedBlockers.length === 0,
    blockers: mergedBlockers,
    totals: {
      ...result.totals,
      legalRecords,
      financialRecords,
      complianceRecords,
    },
  };
}
