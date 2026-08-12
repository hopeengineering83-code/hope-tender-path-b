import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { getSession, requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { enqueueJob } from "../../../../../lib/ai-jobs";
import { isCompanyKnowledgeAIEnabled } from "../../../../../lib/company-knowledge-ai";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../lib/request-id";
import {
  assessReviewEvidence,
  effectiveReviewTrustLevel,
  expertReviewFields,
  isDurablyReviewed,
  isDurablySourceVerified,
  parseStoredStringList,
  projectReviewFields,
  publicVaultIdentifier,
  redactVaultText,
  safeVaultFileLabel,
  sourceByteIntegrityIsVerified,
  VAULT_REVIEW_CONSUMER_SELECT,
} from "../../../../../lib/vault-review-provenance";
import { buildSupportReviewInboxRecord } from "../../../../../lib/vault-review-inbox";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const RECORD_PAGE_SIZE = 10;

type Gap = { severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; title: string; detail: string };
type Pagination = {
  expertPage: number;
  projectPage: number;
  legalPage: number;
  financialPage: number;
  compliancePage: number;
};

async function getCompany(userId: string) {
  return prisma.company.findUnique({ where: { userId }, select: { id: true, name: true } });
}

function usableText(text: string | null | undefined) {
  if (!text || text.trim().length < 100) return false;
  return !/^\[(Scanned PDF|Extraction failed|Legacy \.doc|Image:)/i.test(text.trim());
}

function isExpertSource(fileName: string, category: string, text: string | null | undefined) {
  if (!usableText(text)) return false;
  const sample = `${fileName} ${category}\n${text ?? ""}`;
  return category === "EXPERT_CV" ||
    /cv|expert|staff|resume|personnel|curriculum/i.test(fileName) ||
    /name\s+of\s+(expert|key\s+staff|personnel)|curriculum\s+vitae|proposed\s+position|professional\s+experience/i.test(sample);
}

function isProjectSource(fileName: string, category: string, text: string | null | undefined) {
  if (!usableText(text)) return false;
  const sample = `${fileName} ${category}\n${text ?? ""}`;
  return ["PROJECT_REFERENCE", "PROJECT_CONTRACT", "PORTFOLIO"].includes(category) ||
    /project|portfolio|reference|contract|experience/i.test(fileName) ||
    /project\s+name|client\s+name|selected\s+projects?|assignment\s+name|name\s+of\s+assignment|scope\s+of\s+services|contract\s+value/i.test(sample);
}

function expectedExpertCount(text: string | null | undefined) {
  const direct = (text ?? "").match(/(\d{1,3})\s+(?:experts|expert cvs|cv|cvs|staff|personnel)/i)?.[1];
  return direct ? Number(direct) : null;
}

function expectedProjectCount(text: string | null | undefined) {
  const direct = (text ?? "").match(/(\d{2,3})\s+(?:selected\s+)?projects?/i)?.[1];
  return direct ? Number(direct) : null;
}

function requestedPage(searchParams: URLSearchParams, name: string): number {
  const parsed = Number.parseInt(searchParams.get(name) ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function pageInfo(page: number, total: number) {
  return {
    page,
    pageSize: RECORD_PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / RECORD_PAGE_SIZE)),
  };
}

async function buildDiagnostics(
  companyId: string,
  pagination: Pagination = {
    expertPage: 1,
    projectPage: 1,
    legalPage: 1,
    financialPage: 1,
    compliancePage: 1,
  },
) {
  const [
    docs,
    expertStates,
    projectStates,
    expertPageItems,
    projectPageItems,
    legalStates,
    financialStates,
    complianceStates,
    legalPageItems,
    financialPageItems,
    compliancePageItems,
  ] = await Promise.all([
    prisma.companyDocument.findMany({
      where: { companyId },
      select: {
        id: true,
        originalFileName: true,
        category: true,
        extractedText: true,
        aiExtractionStatus: true,
        contentSha256: true,
        contentByteLength: true,
        integrityStatus: true,
        integrityFailureCode: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.expert.findMany({
      where: { companyId, deletedAt: null },
      select: VAULT_REVIEW_CONSUMER_SELECT.EXPERT,
    }),
    prisma.project.findMany({
      where: { companyId, deletedAt: null },
      select: VAULT_REVIEW_CONSUMER_SELECT.PROJECT,
    }),
    prisma.expert.findMany({
      where: { companyId, deletedAt: null },
      select: {
        id: true,
        companyId: true,
        fullName: true,
        title: true,
        yearsExperience: true,
        disciplines: true,
        sectors: true,
        certifications: true,
        trustLevel: true,
        reviewedBy: true,
        reviewedAt: true,
        reviewNotes: true,
        sourceDocumentId: true,
        sourceDocument: {
          select: {
            id: true,
            companyId: true,
            extractedText: true,
            contentSha256: true,
            contentByteLength: true,
            integrityStatus: true,
            metadata: true,
          },
        },
      },
      orderBy: [{ trustLevel: "asc" }, { createdAt: "desc" }],
      skip: (pagination.expertPage - 1) * RECORD_PAGE_SIZE,
      take: RECORD_PAGE_SIZE,
    }),
    prisma.project.findMany({
      where: { companyId, deletedAt: null },
      select: {
        id: true,
        companyId: true,
        name: true,
        clientName: true,
        country: true,
        sector: true,
        serviceAreas: true,
        contractValue: true,
        currency: true,
        trustLevel: true,
        reviewedBy: true,
        reviewedAt: true,
        reviewNotes: true,
        sourceDocumentId: true,
        sourceDocument: {
          select: {
            id: true,
            companyId: true,
            extractedText: true,
            contentSha256: true,
            contentByteLength: true,
            integrityStatus: true,
            metadata: true,
          },
        },
      },
      orderBy: [{ trustLevel: "asc" }, { createdAt: "desc" }],
      skip: (pagination.projectPage - 1) * RECORD_PAGE_SIZE,
      take: RECORD_PAGE_SIZE,
    }),
    prisma.legalRecord.findMany({
      where: { companyId },
      select: VAULT_REVIEW_CONSUMER_SELECT.LEGAL,
    }),
    prisma.financialRecord.findMany({
      where: { companyId },
      select: VAULT_REVIEW_CONSUMER_SELECT.FINANCIAL,
    }),
    prisma.companyComplianceRecord.findMany({
      where: { companyId },
      select: VAULT_REVIEW_CONSUMER_SELECT.COMPLIANCE,
    }),
    prisma.legalRecord.findMany({
      where: { companyId },
      select: { id: true, ...VAULT_REVIEW_CONSUMER_SELECT.LEGAL },
      orderBy: [{ trustLevel: "asc" }, { createdAt: "desc" }],
      skip: (pagination.legalPage - 1) * RECORD_PAGE_SIZE,
      take: RECORD_PAGE_SIZE,
    }),
    prisma.financialRecord.findMany({
      where: { companyId },
      select: { id: true, ...VAULT_REVIEW_CONSUMER_SELECT.FINANCIAL },
      orderBy: [{ trustLevel: "asc" }, { createdAt: "desc" }],
      skip: (pagination.financialPage - 1) * RECORD_PAGE_SIZE,
      take: RECORD_PAGE_SIZE,
    }),
    prisma.companyComplianceRecord.findMany({
      where: { companyId },
      select: { id: true, ...VAULT_REVIEW_CONSUMER_SELECT.COMPLIANCE },
      orderBy: [{ trustLevel: "asc" }, { createdAt: "desc" }],
      skip: (pagination.compliancePage - 1) * RECORD_PAGE_SIZE,
      take: RECORD_PAGE_SIZE,
    }),
  ]);

  const expertReviewStates = expertStates.map((record) => ({
    ...record,
    sourceDocument: record.sourceDocument?.companyId === companyId ? record.sourceDocument : null,
  }));
  const projectReviewStates = projectStates.map((record) => ({
    ...record,
    sourceDocument: record.sourceDocument?.companyId === companyId ? record.sourceDocument : null,
  }));
  const legalReviewStates = legalStates.map((record) => ({
    ...record,
    sourceDocument: record.sourceDocument?.companyId === companyId ? record.sourceDocument : null,
  }));
  const financialReviewStates = financialStates.map((record) => ({
    ...record,
    sourceDocument: record.sourceDocument?.companyId === companyId ? record.sourceDocument : null,
  }));
  const complianceReviewStates = complianceStates.map((record) => ({
    ...record,
    sourceDocument: record.sourceDocument?.companyId === companyId ? record.sourceDocument : null,
  }));

  const documentDiagnostics = docs.map((doc, index) => {
    const extractedChars = doc.extractedText?.length ?? 0;
    const byteIntegrityVerified = sourceByteIntegrityIsVerified(doc);
    // A document whose stored bytes are gone is a different problem from one
    // that merely has not been verified yet: no amount of re-running the
    // vault job can produce a digest for bytes that no longer exist, so it
    // gets its own status and its own remedy rather than sitting in
    // UNVERIFIED where the wording implies it is still pending.
    const bytesUnavailable = doc.integrityFailureCode === "SOURCE_BYTES_UNAVAILABLE";
    return {
      id: publicVaultIdentifier(doc.id),
      fileName: safeVaultFileLabel(doc.category, index),
      category: doc.category,
      extractedChars,
      status: bytesUnavailable
        ? "SOURCE_BYTES_MISSING"
        : !byteIntegrityVerified ? "UNVERIFIED" : usableText(doc.extractedText) ? "EXTRACTED" : extractedChars > 0 ? "WARNING" : "EMPTY",
      isExpertSource: byteIntegrityVerified && isExpertSource(doc.originalFileName, doc.category, doc.extractedText),
      isProjectSource: byteIntegrityVerified && isProjectSource(doc.originalFileName, doc.category, doc.extractedText),
      aiExtractionStatus: doc.aiExtractionStatus,
    };
  });

  const expertSourceDocuments = documentDiagnostics.filter((document) => document.isExpertSource).length;
  const projectSourceDocuments = documentDiagnostics.filter((document) => document.isProjectSource).length;
  const extractedDocuments = documentDiagnostics.filter((document) => document.status === "EXTRACTED").length;
  const documentsWithUsableText = docs.filter((document) => usableText(document.extractedText)).length;
  const unverifiedDocuments = documentDiagnostics.filter((document) => document.status === "UNVERIFIED").length;
  const bytesMissingDocuments = documentDiagnostics.filter((document) => document.status === "SOURCE_BYTES_MISSING").length;

  const reviewedExperts = expertReviewStates.filter(isDurablyReviewed).length;
  const sourceVerifiedExperts = expertReviewStates.filter(isDurablySourceVerified).length;
  const unsupportedReviewedExperts = expertReviewStates.filter((record) => record.trustLevel === "REVIEWED" && !isDurablyReviewed(record)).length;
  const unsupportedSourceVerifiedExperts = expertReviewStates.filter((record) => record.trustLevel === "SOURCE_VERIFIED" && !isDurablySourceVerified(record)).length;
  const aiDraftExperts = expertStates.filter((expert) => expert.trustLevel === "AI_DRAFT").length;
  const regexDraftExperts = expertStates.filter((expert) => !expert.trustLevel || expert.trustLevel === "REGEX_DRAFT").length;

  const reviewedProjects = projectReviewStates.filter(isDurablyReviewed).length;
  const sourceVerifiedProjects = projectReviewStates.filter(isDurablySourceVerified).length;
  const unsupportedReviewedProjects = projectReviewStates.filter((record) => record.trustLevel === "REVIEWED" && !isDurablyReviewed(record)).length;
  const unsupportedSourceVerifiedProjects = projectReviewStates.filter((record) => record.trustLevel === "SOURCE_VERIFIED" && !isDurablySourceVerified(record)).length;
  const aiDraftProjects = projectStates.filter((project) => project.trustLevel === "AI_DRAFT").length;
  const regexDraftProjects = projectStates.filter((project) => !project.trustLevel || project.trustLevel === "REGEX_DRAFT").length;

  const reviewedLegalRecords = legalReviewStates.filter(isDurablyReviewed).length;
  const sourceVerifiedLegalRecords = legalReviewStates.filter(isDurablySourceVerified).length;
  const unsupportedReviewedLegalRecords = legalReviewStates.filter((record) => record.trustLevel === "REVIEWED" && !isDurablyReviewed(record)).length;
  const reviewedFinancialRecords = financialReviewStates.filter(isDurablyReviewed).length;
  const sourceVerifiedFinancialRecords = financialReviewStates.filter(isDurablySourceVerified).length;
  const unsupportedReviewedFinancialRecords = financialReviewStates.filter((record) => record.trustLevel === "REVIEWED" && !isDurablyReviewed(record)).length;
  const reviewedComplianceRecords = complianceReviewStates.filter(isDurablyReviewed).length;
  const sourceVerifiedComplianceRecords = complianceReviewStates.filter(isDurablySourceVerified).length;
  const unsupportedReviewedComplianceRecords = complianceReviewStates.filter((record) => record.trustLevel === "REVIEWED" && !isDurablyReviewed(record)).length;

  const expectedExperts = docs.map((document) => expectedExpertCount(document.extractedText)).find((count) => count && count > 0) ?? null;
  const expectedProjects = docs.map((document) => expectedProjectCount(document.extractedText)).find((count) => count && count > 0) ?? null;

  const gaps: Gap[] = [];
  if (docs.length === 0) gaps.push({ severity: "CRITICAL", title: "No company documents uploaded", detail: "Upload company evidence, CVs, and project references." });
  if (docs.length > 0 && documentsWithUsableText === 0) gaps.push({ severity: "CRITICAL", title: "No usable extracted text", detail: "Documents exist, but none contain usable extracted text." });
  if (unverifiedDocuments > 0) gaps.push({ severity: "CRITICAL", title: "Source byte integrity is unverified", detail: `${unverifiedDocuments} document(s) cannot support evidence until their stored bytes have a verified SHA-256 digest.` });
  // Stated separately from the gap above, because that one resolves itself
  // once the vault job verifies the bytes and this one never will.
  if (bytesMissingDocuments > 0) gaps.push({ severity: "CRITICAL", title: "Stored document bytes are missing", detail: `${bytesMissingDocuments} document(s) no longer have stored bytes, so they can never be re-extracted or verified. Upload each of these files again to restore them as usable evidence.` });
  if (unsupportedReviewedExperts > 0) gaps.push({ severity: "CRITICAL", title: "Expert records need re-verification", detail: `${unsupportedReviewedExperts} expert record(s) should be re-verified against current source evidence.` });
  if (unsupportedReviewedProjects > 0) gaps.push({ severity: "CRITICAL", title: "Project records need re-verification", detail: `${unsupportedReviewedProjects} project record(s) should be re-verified against current source evidence.` });
  if (unsupportedReviewedLegalRecords > 0) gaps.push({ severity: "CRITICAL", title: "Legal records need re-verification", detail: `${unsupportedReviewedLegalRecords} legal record(s) should be re-verified against current source evidence.` });
  if (unsupportedReviewedFinancialRecords > 0) gaps.push({ severity: "CRITICAL", title: "Financial records need re-verification", detail: `${unsupportedReviewedFinancialRecords} financial record(s) should be re-verified against current source evidence.` });
  if (unsupportedReviewedComplianceRecords > 0) gaps.push({ severity: "CRITICAL", title: "Compliance records need re-verification", detail: `${unsupportedReviewedComplianceRecords} compliance record(s) should be re-verified against current source evidence.` });
  if (unsupportedSourceVerifiedExperts > 0) gaps.push({ severity: "HIGH", title: "Expert source verification is stale", detail: `${unsupportedSourceVerifiedExperts} expert record(s) changed source bytes, extraction revision, source span, or bound fields and require automatic re-verification.` });
  if (unsupportedSourceVerifiedProjects > 0) gaps.push({ severity: "HIGH", title: "Project source verification is stale", detail: `${unsupportedSourceVerifiedProjects} project record(s) changed source bytes, extraction revision, source span, or bound fields and require automatic re-verification.` });
  if (expertSourceDocuments === 0 && expertStates.length > 0) gaps.push({ severity: "HIGH", title: "No expert evidence source detected", detail: "Upload a CV or mixed document containing the exact expert claim." });
  if (projectSourceDocuments === 0 && projectStates.length > 0) gaps.push({ severity: "HIGH", title: "No project evidence source detected", detail: "Upload a project reference or mixed document containing the exact project claim." });
  if (expertStates.length > 0 && reviewedExperts === 0) gaps.push({ severity: "MEDIUM", title: "Experts available for use", detail: `${sourceVerifiedExperts} source-verified and ${expertStates.length - sourceVerifiedExperts} draft/stale expert record(s) exist. Source-verified records are usable immediately; draft and stale records stay blocked until automatic source verification succeeds.` });
  if (projectStates.length > 0 && reviewedProjects === 0) gaps.push({ severity: "MEDIUM", title: "Projects available for use", detail: `${sourceVerifiedProjects} source-verified and ${projectStates.length - sourceVerifiedProjects} draft/stale project record(s) exist. Source-verified records are usable immediately; draft and stale records stay blocked until automatic source verification succeeds.` });
  if (legalStates.length > 0 && reviewedLegalRecords === 0) gaps.push({ severity: "MEDIUM", title: "Legal records available for use", detail: `${sourceVerifiedLegalRecords} source-verified and ${legalStates.length - sourceVerifiedLegalRecords} draft/stale legal record(s) exist.` });
  if (financialStates.length > 0 && reviewedFinancialRecords === 0) gaps.push({ severity: "MEDIUM", title: "Financial records available for use", detail: `${sourceVerifiedFinancialRecords} source-verified and ${financialStates.length - sourceVerifiedFinancialRecords} draft/stale financial record(s) exist.` });
  if (complianceStates.length > 0 && reviewedComplianceRecords === 0) gaps.push({ severity: "MEDIUM", title: "Compliance records available for use", detail: `${sourceVerifiedComplianceRecords} source-verified and ${complianceStates.length - sourceVerifiedComplianceRecords} draft/stale compliance record(s) exist.` });
  if (expectedExperts && expertStates.length < expectedExperts) gaps.push({ severity: "MEDIUM", title: "Fewer experts than expected", detail: `Expected about ${expectedExperts} experts, but ${expertStates.length} records exist.` });
  if (expectedProjects && projectStates.length < expectedProjects) gaps.push({ severity: "MEDIUM", title: "Fewer projects than expected", detail: `Expected about ${expectedProjects} projects, but ${projectStates.length} records exist.` });

  const experts = expertPageItems.map((expert) => {
    const sourceDocument = expert.sourceDocument?.companyId === companyId ? expert.sourceDocument : null;
    const evidence = assessReviewEvidence(sourceDocument, expertReviewFields(expert));
    return {
      id: expert.id,
      fullName: redactVaultText(expert.fullName, 120),
      secondary: redactVaultText(expert.title ?? "Title not recorded", 140),
      tags: parseStoredStringList(expert.disciplines).slice(0, 4).map((value) => redactVaultText(value, 60)),
      trustLevel: effectiveReviewTrustLevel({ ...expert, sourceDocument }),
      canReview: evidence.ok,
      missingEvidenceFields: evidence.ok ? [] : evidence.missingFields.slice(0, 6),
    };
  });

  const projects = projectPageItems.map((project) => {
    const sourceDocument = project.sourceDocument?.companyId === companyId ? project.sourceDocument : null;
    const evidence = assessReviewEvidence(sourceDocument, projectReviewFields(project));
    const clientAndCountry = [project.clientName, project.country].filter(Boolean).join(" · ") || "Client/location not recorded";
    return {
      id: project.id,
      name: redactVaultText(project.name, 140),
      secondary: redactVaultText(clientAndCountry, 160),
      tags: parseStoredStringList(project.serviceAreas).slice(0, 4).map((value) => redactVaultText(value, 60)),
      trustLevel: effectiveReviewTrustLevel({ ...project, sourceDocument }),
      canReview: evidence.ok,
      missingEvidenceFields: evidence.ok ? [] : evidence.missingFields.slice(0, 6),
    };
  });
  const legalRecords = legalPageItems.map((record) => buildSupportReviewInboxRecord("LEGAL", record));
  const financialRecords = financialPageItems.map((record) => buildSupportReviewInboxRecord("FINANCIAL", record));
  const complianceRecords = compliancePageItems.map((record) => buildSupportReviewInboxRecord("COMPLIANCE", record));

  return {
    importVersion: "company-vault-ingestion-v2-source-verification",
    fingerprint: [
      docs.length,
      extractedDocuments,
      expertStates.length,
      projectStates.length,
      legalStates.length,
      financialStates.length,
      complianceStates.length,
      sourceVerifiedExperts,
      sourceVerifiedProjects,
      sourceVerifiedLegalRecords,
      sourceVerifiedFinancialRecords,
      sourceVerifiedComplianceRecords,
    ].join(":"),
    documents: documentDiagnostics,
    totals: {
      documents: docs.length,
      extractedDocuments,
      expertSourceDocuments,
      projectSourceDocuments,
      currentExperts: expertStates.length,
      currentProjects: projectStates.length,
      currentLegalRecords: legalStates.length,
      currentFinancialRecords: financialStates.length,
      currentComplianceRecords: complianceStates.length,
      autoImportedExperts: aiDraftExperts + regexDraftExperts,
      autoImportedProjects: aiDraftProjects + regexDraftProjects,
      parsedExpertDrafts: aiDraftExperts + regexDraftExperts,
      parsedProjectDrafts: aiDraftProjects + regexDraftProjects,
      expectedExperts,
      expectedProjects,
      reviewedExperts,
      reviewedProjects,
      reviewedLegalRecords,
      reviewedFinancialRecords,
      reviewedComplianceRecords,
      sourceVerifiedExperts,
      sourceVerifiedProjects,
      sourceVerifiedLegalRecords,
      sourceVerifiedFinancialRecords,
      sourceVerifiedComplianceRecords,
      unsupportedReviewedExperts,
      unsupportedReviewedProjects,
      unsupportedReviewedLegalRecords,
      unsupportedReviewedFinancialRecords,
      unsupportedReviewedComplianceRecords,
      unsupportedSourceVerifiedExperts,
      unsupportedSourceVerifiedProjects,
      aiDraftExperts,
      aiDraftProjects,
      regexDraftExperts,
      regexDraftProjects,
      aiEnabled: isCompanyKnowledgeAIEnabled(),
    },
    gaps,
    records: {
      experts: { items: experts, ...pageInfo(pagination.expertPage, expertStates.length) },
      projects: { items: projects, ...pageInfo(pagination.projectPage, projectStates.length) },
      legal: { items: legalRecords, ...pageInfo(pagination.legalPage, legalStates.length) },
      financial: { items: financialRecords, ...pageInfo(pagination.financialPage, financialStates.length) },
      compliance: { items: complianceRecords, ...pageInfo(pagination.compliancePage, complianceStates.length) },
    },
  };
}

export async function GET(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const company = await getCompany(userId);
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const diagnostics = await buildDiagnostics(company.id, {
    expertPage: requestedPage(searchParams, "expertPage"),
    projectPage: requestedPage(searchParams, "projectPage"),
    legalPage: requestedPage(searchParams, "legalPage"),
    financialPage: requestedPage(searchParams, "financialPage"),
    compliancePage: requestedPage(searchParams, "compliancePage"),
  });
  return NextResponse.json({ diagnostics });
}

export async function POST(req: Request) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  const requestId = extractRequestId(req);
  const rl = await rateLimitPersistent(`knowledge-repair:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many requests", code: "RATE_LIMITED", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  try {
    await prismaReady;
    const company = await getCompany(actor.id);
    if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

    // ingestCompanyVault can involve an AI extraction pass over every usable
    // company document — moved into the VAULT_INGEST job queue rather than
    // running inline (see lib/ai-job-handlers.ts). The job handler emits the
    // COMPANY_KNOWLEDGE_REPROCESS audit entry once real results are known.
    const job = await enqueueJob({
      userId: actor.id,
      jobType: "VAULT_INGEST",
      input: { companyId: company.id, auditAction: "COMPANY_KNOWLEDGE_REPROCESS" },
    });
    const diagnostics = await buildDiagnostics(company.id);

    return NextResponse.json({ status: "QUEUED", jobId: job.id, diagnostics, requestId });
  } catch (error) {
    logger.error("company knowledge reprocessing failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json(
      {
        error: "Company knowledge reprocessing failed. Retry or contact support with the request ID.",
        code: "COMPANY_KNOWLEDGE_REPROCESS_FAILED",
        requestId,
      },
      { status: 500 },
    );
  }
}
