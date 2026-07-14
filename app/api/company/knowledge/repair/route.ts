import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { getSession, requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { importCompanyKnowledgeFromDocuments } from "../../../../../lib/company-knowledge-import-safe";
import { logAction } from "../../../../../lib/audit";
import { isCompanyKnowledgeAIEnabled } from "../../../../../lib/company-knowledge-ai";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../lib/request-id";

// Vercel route timeout — knowledge repair runs the configured AI provider chain
// across uploaded documents. 60 = Hobby max.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Gap = { severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; title: string; detail: string };

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

async function buildDiagnostics(companyId: string) {
  const [docs, experts, projects] = await Promise.all([
    prisma.companyDocument.findMany({
      where: { companyId },
      select: { id: true, originalFileName: true, category: true, extractedText: true, aiExtractionStatus: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.expert.findMany({ where: { companyId }, select: { trustLevel: true } }),
    prisma.project.findMany({ where: { companyId }, select: { trustLevel: true } }),
  ]);

  const documentDiagnostics = docs.map((doc) => {
    const extractedChars = doc.extractedText?.length ?? 0;
    return {
      id: doc.id,
      fileName: doc.originalFileName,
      category: doc.category,
      extractedChars,
      status: usableText(doc.extractedText) ? "EXTRACTED" : extractedChars > 0 ? "WARNING" : "EMPTY",
      isExpertSource: isExpertSource(doc.originalFileName, doc.category, doc.extractedText),
      isProjectSource: isProjectSource(doc.originalFileName, doc.category, doc.extractedText),
      aiExtractionStatus: doc.aiExtractionStatus,
    };
  });

  const expertSourceDocuments = documentDiagnostics.filter((document) => document.isExpertSource).length;
  const projectSourceDocuments = documentDiagnostics.filter((document) => document.isProjectSource).length;
  const extractedDocuments = documentDiagnostics.filter((document) => document.status === "EXTRACTED").length;
  const reviewedExperts = experts.filter((expert) => expert.trustLevel === "REVIEWED").length;
  const aiDraftExperts = experts.filter((expert) => expert.trustLevel === "AI_DRAFT").length;
  const regexDraftExperts = experts.filter((expert) => !expert.trustLevel || expert.trustLevel === "REGEX_DRAFT").length;
  const reviewedProjects = projects.filter((project) => project.trustLevel === "REVIEWED").length;
  const aiDraftProjects = projects.filter((project) => project.trustLevel === "AI_DRAFT").length;
  const regexDraftProjects = projects.filter((project) => !project.trustLevel || project.trustLevel === "REGEX_DRAFT").length;
  const expectedExperts = docs.map((document) => expectedExpertCount(document.extractedText)).find((count) => count && count > 0) ?? null;
  const expectedProjects = docs.map((document) => expectedProjectCount(document.extractedText)).find((count) => count && count > 0) ?? null;

  const gaps: Gap[] = [];
  if (docs.length === 0) gaps.push({ severity: "CRITICAL", title: "No company documents uploaded", detail: "Upload company profile, CVs, project references, legal records, and evidence documents." });
  if (docs.length > 0 && extractedDocuments === 0) gaps.push({ severity: "CRITICAL", title: "No usable extracted text", detail: "Documents exist, but none contain usable extracted text. Re-upload text PDFs or add OCR/document-intelligence support." });
  if (!isCompanyKnowledgeAIEnabled()) gaps.push({ severity: "CRITICAL", title: "AI extraction is not enabled", detail: "Configure at least one AI provider: ZAI_API_KEY, CEREBRAS_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, TOGETHER_API_KEY, DEEPSEEK_API_KEY, or ANTHROPIC_API_KEY. All 10 providers are automatic. Claude/Anthropic is emergency-only last resort." });

  if (expertSourceDocuments === 0 && reviewedExperts === 0) {
    gaps.push({ severity: "HIGH", title: "No expert source documents detected", detail: "Upload or categorize CV/staff documents so expert extraction can run." });
  } else if (expertSourceDocuments === 0 && reviewedExperts > 0) {
    gaps.push({ severity: "LOW", title: "No dedicated expert source documents detected", detail: `Reviewed records available; dedicated source docs optional. ${reviewedExperts} reviewed expert record(s) are available for tender matching. Upload/categorize CV files later only if you need to rebuild expert records from source documents.` });
  }

  if (projectSourceDocuments === 0 && reviewedProjects === 0) {
    gaps.push({ severity: "HIGH", title: "No project source documents detected", detail: "Upload or categorize project references, portfolios, contracts, or experience sheets." });
  } else if (projectSourceDocuments === 0 && reviewedProjects > 0) {
    gaps.push({ severity: "LOW", title: "No dedicated project source documents detected", detail: `Reviewed records available; dedicated source docs optional. ${reviewedProjects} reviewed project record(s) are available for tender matching. Upload/categorize project-reference files later only if you need to rebuild project records from source documents.` });
  }

  if (experts.length > 0 && reviewedExperts === 0) gaps.push({ severity: "HIGH", title: "Experts are not reviewed", detail: `${experts.length} expert records exist, but none are marked REVIEWED. Review records before final generation.` });
  if (projects.length > 0 && reviewedProjects === 0) gaps.push({ severity: "HIGH", title: "Projects are not reviewed", detail: `${projects.length} project records exist, but none are marked REVIEWED. Review records before final generation.` });
  if (expectedExperts && experts.length < expectedExperts) gaps.push({ severity: "MEDIUM", title: "Fewer experts than expected", detail: `Detected expectation around ${expectedExperts} experts, but only ${experts.length} records exist.` });
  if (expectedProjects && projects.length < expectedProjects) gaps.push({ severity: "MEDIUM", title: "Fewer projects than expected", detail: `Detected expectation around ${expectedProjects} projects, but only ${projects.length} records exist.` });

  return {
    importVersion: "knowledge-import-v-current",
    fingerprint: `${docs.length}:${extractedDocuments}:${experts.length}:${projects.length}`,
    documents: documentDiagnostics,
    totals: {
      documents: docs.length,
      extractedDocuments,
      expertSourceDocuments,
      projectSourceDocuments,
      currentExperts: experts.length,
      currentProjects: projects.length,
      autoImportedExperts: aiDraftExperts + regexDraftExperts,
      autoImportedProjects: aiDraftProjects + regexDraftProjects,
      parsedExpertDrafts: aiDraftExperts + regexDraftExperts,
      parsedProjectDrafts: aiDraftProjects + regexDraftProjects,
      expectedExperts,
      expectedProjects,
      reviewedExperts,
      reviewedProjects,
      aiDraftExperts,
      aiDraftProjects,
      regexDraftExperts,
      regexDraftProjects,
      aiEnabled: isCompanyKnowledgeAIEnabled(),
    },
    gaps,
  };
}

export async function GET() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const company = await getCompany(userId);
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const diagnostics = await buildDiagnostics(company.id);
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

    // The importer signature is importCompanyKnowledgeFromDocuments(companyId).
    // There is no force parameter — the importer always re-derives from the
    // current document set. Do not extract or audit a force flag that has no
    // effect on the runtime; that would mislead operators into thinking they
    // can control re-import behavior via the request body.
    const result = await importCompanyKnowledgeFromDocuments(company.id);
    const diagnostics = await buildDiagnostics(company.id);

    void logAction({
      userId: actor.id,
      action: "COMPANY_KNOWLEDGE_REPAIR",
      entityType: "Company",
      entityId: company.id,
      description: `Ran company knowledge repair for ${company.name}: ${result.expertsCreated} experts and ${result.projectsCreated} projects created`,
      metadata: {
        expertsCreated: result.expertsCreated,
        projectsCreated: result.projectsCreated,
        aiUsed: result.aiUsed,
        aiFailures: result.aiFailures,
        diagnostics: diagnostics.totals,
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
