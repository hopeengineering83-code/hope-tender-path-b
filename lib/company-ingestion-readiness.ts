import type { PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import {
  canUseVaultRecord,
  isDurablyReviewed,
  isDurablySourceVerified,
  VAULT_REVIEW_CONSUMER_SELECT,
} from "./vault-review-provenance";

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
type ReadinessRecord = {
  trustLevel: string | null;
  durableGenerationEligibility?: boolean;
  durableHumanReview?: boolean;
  durableSourceVerification?: boolean;
};
type ReadinessExpert = ReadinessRecord;
type ReadinessProject = ReadinessRecord;

export type IngestionReadinessSnapshot = {
  docs: ReadinessDoc[];
  experts: ReadinessExpert[];
  projects: ReadinessProject[];
};

export type IngestionReadinessOptions = {
  requireDocuments?: boolean;
  /** Backward-compatible name: requires durable evidence eligible for matching/draft generation. */
  requireReviewedExperts?: boolean;
  /** Backward-compatible name: requires durable evidence eligible for matching/draft generation. */
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
    sourceVerifiedExperts: number;
    sourceVerifiedProjects: number;
    humanReviewedExperts: number;
    humanReviewedProjects: number;
    legalRecords: number;
    financialRecords: number;
    complianceRecords: number;
    expectedExperts: number | null;
    expectedProjects: number | null;
    missingExperts: number;
    missingProjects: number;
  };
};

function isGenerationEligibleRecord(record: ReadinessRecord): boolean {
  if (typeof record.durableGenerationEligibility === "boolean") {
    return record.durableGenerationEligibility;
  }
  return record.trustLevel === "REVIEWED" || record.trustLevel === "SOURCE_VERIFIED";
}

function isHumanReviewedRecord(record: ReadinessRecord): boolean {
  return record.durableHumanReview ?? record.trustLevel === "REVIEWED";
}

function isSourceVerifiedRecord(record: ReadinessRecord): boolean {
  return record.durableSourceVerification ?? record.trustLevel === "SOURCE_VERIFIED";
}

function hasRuntimeAuthorityShape(record: unknown): boolean {
  return Boolean(
    record &&
      typeof record === "object" &&
      Object.prototype.hasOwnProperty.call(record, "sourceDocumentId"),
  );
}

export function assessCompanyIngestionReadiness(
  snapshot: IngestionReadinessSnapshot,
  opts: IngestionReadinessOptions = {},
): CompanyIngestionReadiness {
  const requireEligibleExperts = opts.requireReviewedExperts !== false;
  const requireEligibleProjects = opts.requireReviewedProjects !== false;

  const eligibleExperts = snapshot.experts.filter(isGenerationEligibleRecord).length;
  const eligibleProjects = snapshot.projects.filter(isGenerationEligibleRecord).length;
  const sourceVerifiedExperts = snapshot.experts.filter(isSourceVerifiedRecord).length;
  const sourceVerifiedProjects = snapshot.projects.filter(isSourceVerifiedRecord).length;
  const humanReviewedExperts = snapshot.experts.filter(isHumanReviewedRecord).length;
  const humanReviewedProjects = snapshot.projects.filter(isHumanReviewedRecord).length;
  const usefulDocuments = snapshot.docs.filter((doc) => hasUsefulText(doc.extractedText)).length;
  const pendingDocuments = snapshot.docs.filter((doc) => doc.aiExtractionStatus === "PENDING" || doc.aiExtractionStatus === "EXTRACTING").length;
  const failedDocuments = snapshot.docs.filter((doc) => doc.aiExtractionStatus === "FAILED" || Boolean(doc.aiExtractionError)).length;

  const expectedExperts = maxKnown(snapshot.docs.map((doc) => parseExpectedCount(doc.extractedText, /(\d{1,3})\s+(?:experts?|expert\s+cvs?|cvs?|staff|personnel)\b/i)));
  const expectedProjects = maxKnown(snapshot.docs.map((doc) => parseExpectedCount(doc.extractedText, /(\d{1,3})\s+(?:selected\s+)?(?:similar\s+)?(?:projects?|assignments?|references?)\b/i)));
  const missingExperts = expectedExperts ? Math.max(0, expectedExperts - snapshot.experts.length) : 0;
  const missingProjects = expectedProjects ? Math.max(0, expectedProjects - snapshot.projects.length) : 0;

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (opts.requireDocuments && snapshot.docs.length === 0) blockers.push("No Company Vault source documents are available.");
  if (snapshot.docs.length > 0 && usefulDocuments === 0 && eligibleExperts === 0 && eligibleProjects === 0) {
    blockers.push("Company documents are uploaded but no usable extracted knowledge or durably source-backed expert/project records are available yet.");
  }
  if (pendingDocuments > 0 && usefulDocuments === 0 && eligibleExperts === 0 && eligibleProjects === 0) {
    blockers.push("Company knowledge extraction is still pending. Reprocess the company documents before matching or generation.");
  }
  if (requireEligibleExperts && eligibleExperts === 0) blockers.push("No experts are available.");
  if (requireEligibleProjects && eligibleProjects === 0) blockers.push("No projects are available.");

  if (eligibleExperts === 0) warnings.push("No reviewed expert evidence is available yet. Review extracted expert records in the Review Board to enable expert-required tenders.");
  if (eligibleProjects === 0) warnings.push("No reviewed project evidence is available yet. Review extracted project records in the Review Board to enable project-experience tenders.");
  if (sourceVerifiedExperts > 0 && humanReviewedExperts === 0) warnings.push(`${sourceVerifiedExperts} expert record(s) may support matching and draft generation and are ready for final export.`);
  if (sourceVerifiedProjects > 0 && humanReviewedProjects === 0) warnings.push(`${sourceVerifiedProjects} project record(s) may support matching and draft generation and are ready for final export.`);
  if (failedDocuments > 0) warnings.push(`${failedDocuments} company document(s) have failed extraction status and should be reprocessed or replaced.`);
  if (missingExperts > 0) warnings.push(`Expert completeness gap: ${missingExperts} expected expert record(s) are not present in the Company Vault.`);
  if (missingProjects > 0) warnings.push(`Project completeness gap: ${missingProjects} expected project record(s) are not present in the Company Vault.`);

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
      reviewedExperts: eligibleExperts,
      reviewedProjects: eligibleProjects,
      sourceVerifiedExperts,
      sourceVerifiedProjects,
      humanReviewedExperts,
      humanReviewedProjects,
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

export async function getCompanyIngestionReadiness(
  companyId: string,
  opts: IngestionReadinessOptions = {},
  client: PrismaClient = prisma,
): Promise<CompanyIngestionReadiness> {
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
    durableGenerationEligibility: hasRuntimeAuthorityShape(record) ? canUseVaultRecord(record, "GENERATION") : undefined,
    durableHumanReview: hasRuntimeAuthorityShape(record) ? isDurablyReviewed(record) : undefined,
    durableSourceVerification: hasRuntimeAuthorityShape(record) ? isDurablySourceVerified(record) : undefined,
  }));
  const projects: ReadinessProject[] = projectRecords.map((record) => ({
    trustLevel: record.trustLevel,
    durableGenerationEligibility: hasRuntimeAuthorityShape(record) ? canUseVaultRecord(record, "GENERATION") : undefined,
    durableHumanReview: hasRuntimeAuthorityShape(record) ? isDurablyReviewed(record) : undefined,
    durableSourceVerification: hasRuntimeAuthorityShape(record) ? isDurablySourceVerified(record) : undefined,
  }));

  const hasCompanyProfile = Boolean(
    company && (
      hasUsefulText(company.profileSummary) ||
      hasUsefulText(company.description) ||
      (company.legalName ?? "").trim().length > 0 ||
      (company.licenseGrade ?? "").trim().length > 0 ||
      (company.serviceLines ?? "[]") !== "[]" ||
      (company.sectors ?? "[]") !== "[]" ||
      company.setupCompletedAt
    ),
  );
  const hasAnyKnowledgeSource = Boolean(
    hasCompanyProfile ||
    docs.some((doc) => hasUsefulText(doc.extractedText)) ||
    experts.some(isGenerationEligibleRecord) ||
    projects.some(isGenerationEligibleRecord) ||
    legalRecords > 0 ||
    financialRecords > 0 ||
    complianceRecords > 0
  );

  const result = assessCompanyIngestionReadiness({ docs, experts, projects }, opts);
  const extraBlockers: string[] = [];
  if (!company) extraBlockers.push("Company profile has not been created.");
  if (!hasAnyKnowledgeSource) extraBlockers.push("No usable Company Vault source exists. Upload the company profile, CVs, project references, legal records, or financial records before matching or generation.");

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
