import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../lib/prisma";
import { getSession } from "../../../lib/auth";
import { ensureCompanyForUser } from "../../../lib/company-workspace";

const DEFAULT_COMPANY_NAME = "Hope Urban Planning Architectural and Engineering Consultancy";
const DEFAULT_COMPANY_DESCRIPTION = "AI-powered tender proposal generation workspace";

const SUPPORT_ONLY_CATEGORIES = new Set([
  "COMPANY_PROFILE",
  "LEGAL_REGISTRATION",
  "FINANCIAL_STATEMENT",
  "MANUAL",
  "COMPLIANCE_RECORD",
  "CERTIFICATION",
  "OTHER",
]);

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function hasValue(value: unknown): boolean {
  return clean(value).length > 0;
}

function keepOrNull(value: unknown): string | null {
  const text = clean(value);
  return text ? text : null;
}

function chooseIncomingOrExisting(incoming: unknown, existing: unknown): string | null {
  const incomingText = clean(incoming);
  if (incomingText) return incomingText;
  const existingText = clean(existing);
  return existingText || null;
}

function toJsonArray(value: unknown, existing?: string | null): string {
  if (Array.isArray(value)) {
    const next = value.map(clean).filter(Boolean);
    if (next.length > 0) return JSON.stringify(next);
  } else if (hasValue(value)) {
    const next = String(value).split(",").map((v) => v.trim()).filter(Boolean);
    if (next.length > 0) return JSON.stringify(next);
  }
  return existing ?? JSON.stringify([]);
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

function safeParseArr(v: unknown): string[] {
  try { return JSON.parse(v as string) as string[]; } catch { return []; }
}

function normalizeExpert(e: Record<string, unknown>) {
  return { ...e, disciplines: safeParseArr(e.disciplines), sectors: safeParseArr(e.sectors), certifications: safeParseArr(e.certifications) };
}

function normalizeProject(p: Record<string, unknown>) {
  return { ...p, serviceAreas: safeParseArr(p.serviceAreas) };
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return clean(match[1]).slice(0, 1000);
  }
  return null;
}

function collectProfileText(docs: Array<{ category: string; originalFileName: string; extractedText: string | null }>): string {
  const profileDocs = docs.filter((doc) =>
    doc.category === "COMPANY_PROFILE" || /company[_\s-]*profile|profile[_\s-]*summary/i.test(doc.originalFileName),
  );
  return profileDocs.map((doc) => doc.extractedText ?? "").filter(Boolean).join("\n\n");
}

function deriveCompanyProfileFallback(docs: Array<{ category: string; originalFileName: string; extractedText: string | null }>) {
  const text = collectProfileText(docs);
  const name = firstMatch(text, [
    /(HOPE\s+URBAN\s+PLANNING\s+ARCHITECTURAL\s+AND\s+ENGINEERING\s+CONSULTANCY(?:\s+PLC)?)/i,
    /Company\s+Name\s*[:\-]?\s*([^\n\r]{5,180})/i,
  ]);
  const email = firstMatch(text, [/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i]);
  const phone = firstMatch(text, [/((?:\+?251|0)?\s?9\d{2}[\s\-]?\d{3}[\s\-]?\d{3}(?:\s*\/\s*(?:\+?251|0)?\s?9\d{2}[\s\-]?\d{3}[\s\-]?\d{3})?)/i]);
  const website = firstMatch(text, [/(https?:\/\/[^\s]+|(?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?)/i]);
  const address = firstMatch(text, [
    /(Addis\s+Ababa[^\n\r]{0,220})/i,
    /(?:Address|Registered\s+address)\s*[:\-]?\s*([^\n\r]{8,240})/i,
  ]);
  const description = firstMatch(text, [
    /(Multidisciplinary\s+Category[^\n\r]{20,400})/i,
    /(?:Company\s+description|Description)\s*[:\-]?\s*([^\n\r]{20,400})/i,
  ]);
  const summary = text.trim().slice(0, 12000) || null;
  return { name, legalName: name, email, phone, website, address, description, profileSummary: summary };
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

async function getDocumentsForFallback(companyId: string) {
  return prisma.companyDocument.findMany({
    where: { companyId, extractedText: { not: null } },
    select: { category: true, originalFileName: true, extractedText: true },
  });
}

function serializeCompany(company: NonNullable<Awaited<ReturnType<typeof loadCompany>>>, fallback: ReturnType<typeof deriveCompanyProfileFallback>) {
  return {
    ...company,
    name: clean(company.name) || fallback.name || DEFAULT_COMPANY_NAME,
    legalName: clean(company.legalName) || fallback.legalName || "",
    description: clean(company.description) || fallback.description || DEFAULT_COMPANY_DESCRIPTION,
    website: clean(company.website) || fallback.website || "",
    address: clean(company.address) || fallback.address || "",
    phone: clean(company.phone) || fallback.phone || "",
    email: clean(company.email) || fallback.email || "",
    profileSummary: clean(company.profileSummary) || fallback.profileSummary || "",
    experts: company.experts.map(normalizeExpert),
    projects: company.projects.map(normalizeProject),
    expertCount: company.experts.length,
    projectCount: company.projects.length,
    serviceLines: safeParseArr(company.serviceLines),
    sectors: safeParseArr(company.sectors),
  };
}

export async function GET() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const company = await loadCompany(userId);
  if (!company) return NextResponse.json({});

  const docs = await getDocumentsForFallback(company.id);
  const fallback = deriveCompanyProfileFallback(docs);
  return NextResponse.json(serializeCompany(company, fallback));
}

export async function PUT(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  try {
    const body = await req.json();
    const existing = await prisma.company.findUnique({ where: { userId } });

    const company = await prisma.company.upsert({
      where: { userId },
      create: {
        id: crypto.randomUUID(),
        name: clean(body.name) || DEFAULT_COMPANY_NAME,
        legalName: keepOrNull(body.legalName),
        description: keepOrNull(body.description) || DEFAULT_COMPANY_DESCRIPTION,
        website: keepOrNull(body.website),
        address: keepOrNull(body.address),
        phone: keepOrNull(body.phone),
        email: keepOrNull(body.email),
        country: keepOrNull(body.country),
        serviceLines: toJsonArray(body.serviceLines),
        sectors: toJsonArray(body.sectors),
        profileSummary: keepOrNull(body.profileSummary),
        knowledgeMode: clean(body.knowledgeMode) || "PROFILE_FIRST",
        setupCompletedAt: body.setupCompletedAt ? new Date(body.setupCompletedAt as string) : null,
        userId,
      },
      update: {
        name: chooseIncomingOrExisting(body.name, existing?.name) || DEFAULT_COMPANY_NAME,
        legalName: chooseIncomingOrExisting(body.legalName, existing?.legalName),
        description: chooseIncomingOrExisting(body.description, existing?.description) || DEFAULT_COMPANY_DESCRIPTION,
        website: chooseIncomingOrExisting(body.website, existing?.website),
        address: chooseIncomingOrExisting(body.address, existing?.address),
        phone: chooseIncomingOrExisting(body.phone, existing?.phone),
        email: chooseIncomingOrExisting(body.email, existing?.email),
        country: chooseIncomingOrExisting(body.country, existing?.country),
        serviceLines: toJsonArray(body.serviceLines, existing?.serviceLines),
        sectors: toJsonArray(body.sectors, existing?.sectors),
        profileSummary: chooseIncomingOrExisting(body.profileSummary, existing?.profileSummary),
        ...(body.knowledgeMode !== undefined && { knowledgeMode: clean(body.knowledgeMode) || existing?.knowledgeMode || "PROFILE_FIRST" }),
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
    const docs = await getDocumentsForFallback(refreshed.id);
    const fallback = deriveCompanyProfileFallback(docs);
    return NextResponse.json(serializeCompany(refreshed, fallback));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to save company" }, { status: 500 });
  }
}
