import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { getSession, requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { importCompanyKnowledgeFromDocuments } from "../../../../../lib/company-knowledge-import-safe";
import { logAction } from "../../../../../lib/audit";
import { isCompanyKnowledgeAIEnabled } from "../../../../../lib/company-knowledge-ai";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../lib/request-id";
import {
  assessReviewEvidence,
  effectiveReviewTrustLevel,
  expertReviewFields,
  isDurablyReviewed,
  parseStoredStringList,
  projectReviewFields,
  publicVaultIdentifier,
  redactVaultText,
  safeVaultFileLabel,
  sourceByteIntegrityIsVerified,
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
  const label = `${fileName} ${category}`.toLowerCase();
  if (/project|portfolio|contract|reference/.test(label) && !/cv|expert|staff|personnel|resume/.test(label)) return false;
  return /cv|expert|staff|resume|personnel|curriculum/.test(label) || /name\s+of\s+(expert|key\s+staff|personnel)|curriculum\s+vitae|proposed\s+position/i.test(text ?? "");
}

function isProjectSource(fileName: string, category: string, text: string | null | undefined) {
  if (!usableText(text)) return false;
  const label = `${fileName} ${category}`.toLowerCase();
  if (/cv|expert|staff|resume|personnel/.test(label) && !/project|portfolio|contract|reference/.test(label)) return false;
  return /project|portfolio|reference|contract|experience/.test(label) || /project\s+name|client\s+name|selected\s+projects?|assignment\s+name|name\s+of\s+assignment/i.test(text ?? "");
}

function expectedExpertCount(text: string | null | undefined) {
  const direct = (text ?? "").match(/(\d{1,3})\s+(?:experts|expert cvs|cv|cvs|staff|personnel)/i)?.[1];
  return direct ? Number(direct) : null;
}

function expectedProjectCount(text: string | null | undefined) {
  const direct = (text ?? "").match(/(\d{2,3})\s+(?:selected\s+)?projects?/i)?.[1];
  return direct ? Number(direct) : null;
}

function requestedPage(searchParams: URLSearchParams, key: string): number {
  const parsed = Number.parseInt(searchParams.get(key) ?? "1", 10);
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
      select: {
        companyId: true,
        trustLevel: true,
        reviewedBy: true,
        reviewedAt: true,
        reviewNotes: true,
        sourceDocumentId: true,
        sourceDocument: {
          select: { id: true, companyId: true, extractedText: true, contentSha256: true, contentByteLength: true, integrityStatus: true },
        },
      },
    }),
    prisma.project.findMany({
      where: { companyId, deletedAt: null },
      select: {
        companyId: true,
        trustLevel: true,
        reviewedBy: true,
        reviewedAt: true,
        reviewNotes: true,
        sourceDocumentId: true,
        sourceDocument: {
          select: { id: true, companyId: true, extractedText: true, contentSha256: true, contentByteLength: true, integrityStatus: true },
        },
      },
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
          select: { id: true, companyId: true, extractedText: true, contentSha256: true, contentByteLength: true, integrityStatus: true },
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
          select: { id: true, companyId: true, extractedText: true, contentSha256: true, contentByteLength: true, integrityStatus: true },
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
  const unsupportedReviewedExperts = expertReviewStates.filter((record) => record.trustLevel === "REVIEWED" && !isDurablyReviewed(record)).length;
  const aiDraftExperts = expertStates.filter((expert) => expert.trustLevel === "AI_DRAFT").length;
  const regexDraftExperts = expertStates.filter((expert) => !expert.trustLevel || expert.trustLevel === "REGEX_DRAFT").length;
  const reviewedProjects = projectReviewStates.filter(isDurablyReviewed).length;
  const unsupportedReviewedProjects = projectReviewStates.filter((record) => record.trustLevel === "REVIEWED" && !isDurablyReviewed(record)).length;
  const aiDraftProjects = projectStates.filter((project) => project.trustLevel === "AI_DRAFT").length;
  const regexDraftProjects = projectStates.filter((project) => !project.trustLevel || project.trustLevel === "REGEX_DRAFT").length;
  const expectedExperts = docs.map((document) => expectedExpertCount(document.extractedText)).find((count) => count && count > 0) ?? null;
  const expectedProjects = docs.map((document) => expectedProjectCount(document.extractedText)).find((count) => count && count > 0) ?? null;

  const gaps: Gap[] = [];
  if (docs.length === 0) gaps.push({ severity: "CRITICAL", title: "No company documents uploaded", detail: "Upload company evidence, CVs, and project references." });
  if (docs.length > 0 && documentsWithUsableText === 0) gaps.push({ severity: "CRITICAL", title: "No usable extracted text", detail: "Documents exist, but none contain usable extracted text." });
  if (unverifiedDocuments > 0) gaps.push({ severity: "CRITICAL", title: "Source byte integrity is unverified", detail: `${unverifiedDocuments} document(s) cannot support reviewed evidence until their stored bytes have a verified SHA-256 digest.` });
  if (!isCompanyKnowledgeAIEnabled()) gaps.push({ severity: "CRITICAL", title: "AI extraction is not enabled", detail: "Configure an approved AI provider before automated extraction." });
  if (unsupportedReviewedExperts > 0) gaps.push({ severity: "CRITICAL", title: "Expert reviews lack durable provenance", detail: `${unsupportedReviewedExperts} expert record(s) are blocked until source evidence and reviewer audit are recorded.` });
  if (unsupportedReviewedProjects > 0) gaps.push({ severity: "CRITICAL", title: "Project reviews lack durable provenance", detail: `${unsupportedReviewedProjects} project record(s) are blocked until source evidence and reviewer audit are recorded.` });
  if (expertSourceDocuments === 0) gaps.push({ severity: "HIGH", title: "No expert source documents detected", detail: "Expert records cannot become usable without an owned CV/staff source document and field evidence." });
  if (projectSourceDocuments === 0) gaps.push({ severity: "HIGH", title: "No project source documents detected", detail: "Project records cannot become usable without an owned project-reference source document and field evidence." });
  if (expertStates.length > 0 && reviewedExperts === 0) gaps.push({ severity: "HIGH", title: "No provenance-verified experts", detail: `${expertStates.length} expert record(s) exist, but none has a valid durable review.` });
  if (projectStates.length > 0 && reviewedProjects === 0) gaps.push({ severity: "HIGH", title: "No provenance-verified projects", detail: `${projectStates.length} project record(s) exist, but none has a valid durable review.` });
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
    importVersion: "knowledge-import-v-provenance-1",
    fingerprint: `${docs.length}:${extractedDocuments}:${expertStates.length}:${projectStates.length}`,
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
      unsupportedReviewedExperts,
      unsupportedReviewedProjects,
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

    const result = await importCompanyKnowledgeFromDocuments(company.id);
    const diagnostics = await buildDiagnostics(company.id);

    void logAction({
      userId: actor.id,
      action: "COMPANY_KNOWLEDGE_REPAIR",
      entityType: "Company",
      entityId: company.id,
      description: "Company knowledge repair completed.",
      metadata: {
        expertsCreated: result.expertsCreated,
        projectsCreated: result.projectsCreated,
        aiUsed: Boolean(result.aiUsed),
      },
      requestId,
    }).catch((error) => {
      logger.warn("company knowledge repair audit persistence failed", {
        requestId,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
    });

    return NextResponse.json({ result: { ...result, diagnostics }, requestId });
  } catch (error) {
    logger.error("company knowledge repair failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json(
      {
        error: "Company knowledge repair failed. Retry or contact support with the request ID.",
        code: "COMPANY_KNOWLEDGE_REPAIR_FAILED",
        requestId,
      },
      { status: 500 },
    );
  }
}
