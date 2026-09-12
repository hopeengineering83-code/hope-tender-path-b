import { logger } from "../../../lib/observability";
import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../lib/prisma";
import { getSession, requireRole, forbiddenResponse, unauthorizedResponse } from "../../../lib/auth";
import { ensureCompanyForUser } from "../../../lib/company-workspace";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../lib/rate-limit";
import { logAction } from "../../../lib/audit";
import { extractRequestId } from "../../../lib/request-id";

const DEFAULT_COMPANY_NAME = "Hope Urban Planning Architectural and Engineering Consultancy";
const DEFAULT_COMPANY_DESCRIPTION = "AI-powered tender proposal generation workspace";

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
  await ensureCompanyForUser(prisma, userId);
  // Read requests must not delete Expert or Project records. Destructive
  // support-import cleanup is available only through its explicit role-gated
  // mutation endpoint.
  // Filter deletedAt: null so soft-deleted records don't appear in the UI
  // (the single/bulk delete handlers set deletedAt — the read must respect it).
  return prisma.company.findUnique({
    where: { userId },
    include: {
      experts: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
      projects: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
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
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  const requestId = extractRequestId(req);
  const rl = await rateLimitPersistent(`company-update:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many profile update requests. Wait a moment and retry.", code: "RATE_LIMITED", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  await prismaReady;
  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });

    // Validate setupCompletedAt BEFORE any database write.
    if (body.setupCompletedAt !== undefined && body.setupCompletedAt !== null) {
      const validated = new Date(body.setupCompletedAt as string);
      if (isNaN(validated.getTime())) {
        return NextResponse.json(
          { error: "setupCompletedAt must be a valid ISO 8601 date string", code: "INVALID_DATE", field: "setupCompletedAt", requestId },
          { status: 400 },
        );
      }
    }

    const existing = await prisma.company.findUnique({ where: { userId: actor.id } });

    const company = await prisma.company.upsert({
      where: { userId: actor.id },
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
        setupCompletedAt: body.setupCompletedAt ? (() => {
          const d = new Date(body.setupCompletedAt as string);
          return isNaN(d.getTime()) ? null : d;
        })() : null,
        gmName: keepOrNull(body.gmName),
        gmTitle: keepOrNull(body.gmTitle),
        gmLicense: keepOrNull(body.gmLicense),
        foundingYear: typeof body.foundingYear === "number" ? body.foundingYear : (clean(body.foundingYear) ? Number(clean(body.foundingYear)) : null),
        headcount: typeof body.headcount === "number" ? body.headcount : (clean(body.headcount) ? Number(clean(body.headcount)) : null),
        licenseGrade: keepOrNull(body.licenseGrade),
        registrationNumber: keepOrNull(body.registrationNumber),
        tin: keepOrNull(body.tin),
        vat: keepOrNull(body.vat),
        userId: actor.id,
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
        ...(body.setupCompletedAt !== undefined && { setupCompletedAt: body.setupCompletedAt === null ? null : (() => {
          const d = new Date(body.setupCompletedAt as string);
          return isNaN(d.getTime()) ? null : d;
        })() }),
        ...(body.gmName !== undefined && { gmName: chooseIncomingOrExisting(body.gmName, existing?.gmName) }),
        ...(body.gmTitle !== undefined && { gmTitle: chooseIncomingOrExisting(body.gmTitle, existing?.gmTitle) }),
        ...(body.gmLicense !== undefined && { gmLicense: chooseIncomingOrExisting(body.gmLicense, existing?.gmLicense) }),
        ...(body.foundingYear !== undefined && { foundingYear: typeof body.foundingYear === "number" ? body.foundingYear : (clean(body.foundingYear) ? Number(clean(body.foundingYear)) : null) }),
        ...(body.headcount !== undefined && { headcount: typeof body.headcount === "number" ? body.headcount : (clean(body.headcount) ? Number(clean(body.headcount)) : null) }),
        ...(body.licenseGrade !== undefined && { licenseGrade: chooseIncomingOrExisting(body.licenseGrade, existing?.licenseGrade) }),
        ...(body.registrationNumber !== undefined && { registrationNumber: chooseIncomingOrExisting(body.registrationNumber, existing?.registrationNumber) }),
        ...(body.tin !== undefined && { tin: chooseIncomingOrExisting(body.tin, existing?.tin) }),
        ...(body.vat !== undefined && { vat: chooseIncomingOrExisting(body.vat, existing?.vat) }),
        updatedAt: new Date(),
      },
      include: {
        experts: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
        projects: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
      },
    });

    // Profile updates must not delete knowledge records as an unrelated side
    // effect. The explicit support-import cleanup endpoint owns that operation.

    try {
      const { extractCompanyFacts, mergeFactsIntoCompany } = await import("../../../lib/engine/company-fact-extractor");
      if (company.profileSummary && company.profileSummary.trim().length > 100) {
        const extracted = extractCompanyFacts(company.profileSummary);
        const update = mergeFactsIntoCompany(company, extracted);
        if (Object.keys(update).length > 0) {
          await prisma.company.update({ where: { id: company.id }, data: update });
          logger.info(`[company-fact-extractor] Auto-filled ${Object.keys(update).length} field(s):`, { detail: Object.keys(update).join(", ") });
        }
      }
    } catch (error) {
      logger.warn("[company-fact-extractor] auto-extraction failed", {
        requestId,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
    }

    const refreshed = await prisma.company.findUnique({
      where: { userId: actor.id },
      include: {
        experts: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
        projects: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
      },
    });

    if (!refreshed) return NextResponse.json({});
    void logAction({
      userId: actor.id,
      action: "COMPANY_PROFILE_UPDATED",
      entityType: "Company",
      entityId: refreshed.id,
      description: "Company profile updated",
      requestId,
    }).catch((error) => {
      logger.warn("company profile audit persistence failed", {
        requestId,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
    });
    const docs = await getDocumentsForFallback(refreshed.id);
    const fallback = deriveCompanyProfileFallback(docs);
    return NextResponse.json(serializeCompany(refreshed, fallback));
  } catch (error) {
    logger.error("company profile update failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "Failed to save company", code: "COMPANY_PROFILE_UPDATE_FAILED", requestId },
      { status: 500 },
    );
  }
}
