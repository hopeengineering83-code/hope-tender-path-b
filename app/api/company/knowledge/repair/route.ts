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

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const RECORD_PAGE_SIZE = 10;

type Gap = { severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; title: string; detail: string };
type Pagination = { expertPage: number; projectPage: number };

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
  pagination: Pagination = { expertPage: 1, projectPage: 1 },
) {
  const [docs, expertStates, projectStates, expertPageItems, projectPageItems] = await Promise.all([
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
  ]);

  const expertReviewStates = expertStates.map((record) => ({
    ...record,
    sourceDocument: record.sourceDocument?.companyId === companyId ? record.sourceDocument : null,
  }));
  const projectReviewStates = projectStates.map((record) => ({
    ...record,
    sourceDocument: record.sourceDocument?.companyId === companyId ? record.sourceDocument : null,
  }));

  const documentDiagnostics = docs.map((doc, index) => {
    const extractedChars = doc.extractedText?.length ?? 0;
    const byteIntegrityVerified = sourceByteIntegrityIsVerified(doc);
    return {
      id: publicVaultIdentifier(doc.id),
      fileName: safeVaultFileLabel(doc.category, index),
      category: doc.category,
      extractedChars,
      status: !byteIntegrityVerified ? "UNVERIFIED" : usableText(doc.extractedText) ? "EXTRACTED" : extractedChars > 0 ? "WARNING" : "EMPTY",
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

  const expectedExperts = docs.map((document) => expectedExpertCount(document.extractedText)).find((count) => count && count > 0) ?? null;
  const expectedProjects = docs.map((document) => expectedProjectCount(document.extractedText)).find((count) => count && count > 0) ?? null;

  const gaps: Gap[] = [];
  if (docs.length === 0) gaps.push({ severity: "CRITICAL", title: "No company documents uploaded", detail: "Upload company evidence, CVs, and project references." });
  if (docs.length > 0 && documentsWithUsableText === 0) gaps.push({ severity: "CRITICAL", title: "No usable extracted text", detail: "Documents exist, but none contain usable extracted text." });
  if (unverifiedDocuments > 0) gaps.push({ severity: "CRITICAL", title: "Source byte integrity is unverified", detail: `${unverifiedDocuments} document(s) cannot support evidence until their stored bytes have a verified SHA-256 digest.` });
  if (unsupportedReviewedExperts > 0) gaps.push({ severity: "CRITICAL", title: "Expert human reviews are stale", detail: `${unsupportedReviewedExperts} expert record(s) are blocked until current source evidence is human-reviewed again.` });
  if (unsupportedReviewedProjects > 0) gaps.push({ severity: "CRITICAL", title: "Project human reviews are stale", detail: `${unsupportedReviewedProjects} project record(s) are blocked until current source evidence is human-reviewed again.` });
  if (unsupportedSourceVerifiedExperts > 0) gaps.push({ severity: "HIGH", title: "Expert source verification is stale", detail: `${unsupportedSourceVerifiedExperts} expert record(s) changed source bytes, extraction revision, source span, or bound fields and require automatic re-verification.` });
  if (unsupportedSourceVerifiedProjects > 0) gaps.push({ severity: "HIGH", title: "Project source verification is stale", detail: `${unsupportedSourceVerifiedProjects} project record(s) changed source bytes, extraction revision, source span, or bound fields and require automatic re-verification.` });
  if (expertSourceDocuments === 0 && expertStates.length > 0) gaps.push({ severity: "HIGH", title: "No expert evidence source detected", detail: "Upload a CV or mixed document containing the exact expert claim." });
  if (projectSourceDocuments === 0 && projectStates.length > 0) gaps.push({ severity: "HIGH", title: "No project evidence source detected", detail: "Upload a project reference or mixed document containing the exact project claim." });
  if (expertStates.length > 0 && reviewedExperts === 0) gaps.push({ severity: "MEDIUM", title: "Experts await human review", detail: `${sourceVerifiedExperts} source-verified and ${expertStates.length - sourceVerifiedExperts} draft/stale expert record(s) exist. Final-package eligibility requires genuine human review.` });
  if (projectStates.length > 0 && reviewedProjects === 0) gaps.push({ severity: "MEDIUM", title: "Projects await human review", detail: `${sourceVerifiedProjects} source-verified and ${projectStates.length - sourceVerifiedProjects} draft/stale project record(s) exist. Final-package eligibility requires genuine human review.` });
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

  return {
    importVersion: "company-vault-ingestion-v2-source-verification",
    fingerprint: `${docs.length}:${extractedDocuments}:${expertStates.length}:${projectStates.length}:${sourceVerifiedExperts}:${sourceVerifiedProjects}`,
    documents: documentDiagnostics,
    totals: {
      documents: docs.length,
      extractedDocuments,
      expertSourceDocuments,
      projectSourceDocuments,
      currentExperts: expertStates.length,
      currentProjects: projectStates.length,
      autoImportedExperts: aiDraftExperts + regexDraftExperts,
      autoImportedProjects: aiDraftProjects + regexDraftProjects,
      parsedExpertDrafts: aiDraftExperts + regexDraftExperts,
      parsedProjectDrafts: aiDraftProjects + regexDraftProjects,
      expectedExperts,
      expectedProjects,
      reviewedExperts,
      reviewedProjects,
      sourceVerifiedExperts,
      sourceVerifiedProjects,
      unsupportedReviewedExperts,
      unsupportedReviewedProjects,
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
