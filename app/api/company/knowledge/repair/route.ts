import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { importCompanyKnowledgeFromDocuments } from "../../../../../lib/company-knowledge-import-safe";
import { logAction } from "../../../../../lib/audit";
import { isAIEnabled } from "../../../../../lib/ai";

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

  const expertSourceDocuments = documentDiagnostics.filter((d) => d.isExpertSource).length;
  const projectSourceDocuments = documentDiagnostics.filter((d) => d.isProjectSource).length;
  const extractedDocuments = documentDiagnostics.filter((d) => d.status === "EXTRACTED").length;
  const reviewedExperts = experts.filter((e) => e.trustLevel === "REVIEWED").length;
  const aiDraftExperts = experts.filter((e) => e.trustLevel === "AI_DRAFT").length;
  const regexDraftExperts = experts.filter((e) => !e.trustLevel || e.trustLevel === "REGEX_DRAFT").length;
  const reviewedProjects = projects.filter((p) => p.trustLevel === "REVIEWED").length;
  const aiDraftProjects = projects.filter((p) => p.trustLevel === "AI_DRAFT").length;
  const regexDraftProjects = projects.filter((p) => !p.trustLevel || p.trustLevel === "REGEX_DRAFT").length;
  const expectedExperts = docs.map((d) => expectedExpertCount(d.extractedText)).find((n) => n && n > 0) ?? null;
  const expectedProjects = docs.map((d) => expectedProjectCount(d.extractedText)).find((n) => n && n > 0) ?? null;

  const gaps: Gap[] = [];
  if (docs.length === 0) gaps.push({ severity: "CRITICAL", title: "No company documents uploaded", detail: "Upload company profile, CVs, project references, legal records, and evidence documents." });
  if (docs.length > 0 && extractedDocuments === 0) gaps.push({ severity: "CRITICAL", title: "No usable extracted text", detail: "Documents exist, but none contain usable extracted text. Re-upload text PDFs or add OCR/document-intelligence support." });
  if (!isAIEnabled()) gaps.push({ severity: "CRITICAL", title: "AI extraction is not enabled", detail: "GEMINI_API_KEY is required for reliable extraction from complex CV and project-reference PDFs." });
  if (expertSourceDocuments === 0) gaps.push({ severity: "HIGH", title: "No expert source documents detected", detail: "Upload or categorize CV/staff documents so expert extraction can run." });
  if (projectSourceDocuments === 0) gaps.push({ severity: "HIGH", title: "No project source documents detected", detail: "Upload or categorize project references, portfolios, contracts, or experience sheets." });
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
      aiEnabled: isAIEnabled(),
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
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const company = await getCompany(userId);
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const force = body?.force !== false;

  const result = await importCompanyKnowledgeFromDocuments(company.id);
  const diagnostics = await buildDiagnostics(company.id);

  await logAction({
    userId,
    action: "COMPANY_KNOWLEDGE_REPAIR",
    entityType: "Company",
    entityId: company.id,
    description: `Ran company knowledge repair for ${company.name}: ${result.expertsCreated} experts and ${result.projectsCreated} projects created`,
    metadata: {
      force,
      expertsCreated: result.expertsCreated,
      projectsCreated: result.projectsCreated,
      aiUsed: result.aiUsed,
      aiFailures: result.aiFailures,
      diagnostics: diagnostics.totals,
    },
  });

  return NextResponse.json({ result: { ...result, diagnostics } });
}
