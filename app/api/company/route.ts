import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../lib/prisma";
import { getSession } from "../../../lib/auth";
import { ensureCompanyForUser } from "../../../lib/company-workspace";

const SUPPORT_ONLY_CATEGORIES = new Set([
  "COMPANY_PROFILE",
  "LEGAL_REGISTRATION",
  "FINANCIAL_STATEMENT",
  "MANUAL",
  "COMPLIANCE_RECORD",
  "CERTIFICATION",
  "OTHER",
]);

function toJsonArray(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.filter(Boolean));
  return JSON.stringify(
    String(value || "").split(",").map((v) => v.trim()).filter(Boolean)
  );
}

async function cleanupSupportDocImportedRecords(companyId: string) {
  const supportDocs = await prisma.companyDocument.findMany({
    where: { companyId, category: { in: [...SUPPORT_ONLY_CATEGORIES] } },
    select: { id: true, originalFileName: true },
  });
  const supportDocIds = supportDocs.map((d) => d.id);
  const supportFileNames = supportDocs.map((d) => d.originalFileName).filter(Boolean);

  await Promise.all([
    supportDocIds.length ? prisma.expert.deleteMany({ where: { companyId, sourceDocumentId: { in: supportDocIds } } }) : Promise.resolve({ count: 0 }),
    supportDocIds.length ? prisma.project.deleteMany({ where: { companyId, sourceDocumentId: { in: supportDocIds } } }) : Promise.resolve({ count: 0 }),
  ]);

  for (const fileName of supportFileNames) {
    const expertIds = await prisma.expert.findMany({ where: { companyId, profile: { contains: fileName, mode: "insensitive" } }, select: { id: true } });
    const projectIds = await prisma.project.findMany({ where: { companyId, summary: { contains: fileName, mode: "insensitive" } }, select: { id: true } });
    if (expertIds.length) await prisma.expert.deleteMany({ where: { id: { in: expertIds.map((e) => e.id) } } });
    if (projectIds.length) await prisma.project.deleteMany({ where: { id: { in: projectIds.map((p) => p.id) } } });
  }
}

async function loadCompany(userId: string) {
  const companyBase = await ensureCompanyForUser(prisma, userId);
  await cleanupSupportDocImportedRecords(companyBase.id);
  return prisma.company.findUnique({
    where: { userId },
    include: {
      experts: { orderBy: { createdAt: "desc" } },
      projects: { orderBy: { createdAt: "desc" } },
    },
  });
}

export async function GET() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const company = await loadCompany(userId);

  if (!company) return NextResponse.json({});

  return NextResponse.json({
    ...company,
    experts: company.experts.map(normalizeExpert),
    projects: company.projects.map(normalizeProject),
    expertCount: company.experts.length,
    projectCount: company.projects.length,
    serviceLines: safeParseArr(company.serviceLines),
    sectors: safeParseArr(company.sectors),
  });
}

function safeParseArr(v: unknown): string[] {
  try { return JSON.parse(v as string) as string[]; } catch { return []; }
}

function normalizeExpert(e: Record<string, unknown>) {
  return { ...e, disciplines: safeParseArr(e.disciplines), sectors: safeParseArr(e.sectors), certifications: safeParseArr(e.certifications) };
}

function normalizeProject(p: Record<string, unknown>) {
  return { ...p, serviceAreas: safeParseArr(p.serviceAreas) };
}

export async function PUT(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  try {
    const body = await req.json();
    const company = await prisma.company.upsert({
      where: { userId },
      create: {
        id: crypto.randomUUID(),
        name: body.name || "Hope Urban Planning Architectural and Engineering Consultancy",
        legalName: body.legalName || null,
        description: body.description || null,
        website: body.website || null,
        address: body.address || null,
        phone: body.phone || null,
        email: body.email || null,
        country: body.country || null,
        serviceLines: toJsonArray(body.serviceLines),
        sectors: toJsonArray(body.sectors),
        profileSummary: body.profileSummary || null,
        knowledgeMode: body.knowledgeMode || "PROFILE_FIRST",
        setupCompletedAt: body.setupCompletedAt ? new Date(body.setupCompletedAt as string) : null,
        userId,
      },
      update: {
        ...(body.name !== undefined && { name: body.name }),
        legalName: body.legalName || null,
        description: body.description || null,
        website: body.website || null,
        address: body.address || null,
        phone: body.phone || null,
        email: body.email || null,
        country: body.country || null,
        serviceLines: toJsonArray(body.serviceLines),
        sectors: toJsonArray(body.sectors),
        profileSummary: body.profileSummary || null,
        ...(body.knowledgeMode !== undefined && { knowledgeMode: body.knowledgeMode }),
        ...(body.setupCompletedAt !== undefined && { setupCompletedAt: new Date(body.setupCompletedAt as string) }),
        updatedAt: new Date(),
      },
      include: {
        experts: { orderBy: { createdAt: "desc" } },
        projects: { orderBy: { createdAt: "desc" } },
      },
    });

    await cleanupSupportDocImportedRecords(company.id);
    const refreshed = await prisma.company.findUnique({
      where: { userId },
      include: { experts: { orderBy: { createdAt: "desc" } }, projects: { orderBy: { createdAt: "desc" } } },
    });

    if (!refreshed) return NextResponse.json({});

    return NextResponse.json({
      ...refreshed,
      experts: refreshed.experts.map(normalizeExpert),
      projects: refreshed.projects.map(normalizeProject),
      expertCount: refreshed.experts.length,
      projectCount: refreshed.projects.length,
      serviceLines: safeParseArr(refreshed.serviceLines),
      sectors: safeParseArr(refreshed.sectors),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to save company" }, { status: 500 });
  }
}
