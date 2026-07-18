import { logger } from "../../../../lib/observability";
import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { requireRole, forbiddenResponse, unauthorizedResponse, getSession } from "../../../../lib/auth";
import { logAction } from "../../../../lib/audit";
import { MUTATION_RATE_LIMIT, rateLimit } from "../../../../lib/rate-limit";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function parseBoundedLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(parsed, MAX_PAGE_SIZE);
}


function toJsonArray(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.filter(Boolean));
  return JSON.stringify(
    String(value || "").split(",").map((v) => v.trim()).filter(Boolean)
  );
}

function safeParseArr(v: unknown): string[] {
  try { return JSON.parse(v as string) as string[]; } catch { return []; }
}

function normalizeProject(p: Record<string, unknown>) {
  return { ...p, serviceAreas: safeParseArr(p.serviceAreas) };
}

export async function GET(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const { searchParams } = new URL(req.url);
  const limit = parseBoundedLimit(searchParams.get("limit"));
  const cursor = searchParams.get("cursor") ?? undefined;
  const trustLevel = searchParams.get("trustLevel") ?? undefined;
  const q = searchParams.get("q") ?? "";

  const company = await ensureCompanyForUser(prisma, userId);

  const projects = await prisma.project.findMany({
    where: {
      companyId: company.id,
      deletedAt: null,
      ...(trustLevel ? { trustLevel } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { clientName: { contains: q } }, { sector: { contains: q } }] } : {}),
    },
    orderBy: [{ trustLevel: "asc" }, { createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: { id: true, name: true, clientName: true, country: true, sector: true, serviceAreas: true, trustLevel: true, createdAt: true },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = projects.length > limit;
  const items = hasMore ? projects.slice(0, limit) : projects;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return NextResponse.json({ items: items.map(normalizeProject), nextCursor, hasMore });
}

export async function POST(req: Request) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const rl = rateLimit(`project-create:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many project creation requests. Wait and retry.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
  }

  await prismaReady;
  const company = await ensureCompanyForUser(prisma, actor.id);

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    if (!body.name || String(body.name).trim().length < 2) {
      return NextResponse.json({ error: "Project name is required (min 2 characters)" }, { status: 400 });
    }
    const contractValue = body.contractValue ? Number(body.contractValue) : null;
    if (contractValue !== null && (!Number.isFinite(contractValue) || contractValue < 0 || contractValue > 1e12)) {
      return NextResponse.json({ error: "contractValue must be a finite non-negative number up to 1,000,000,000,000" }, { status: 400 });
    }
    // Optional sourceDocumentId — when the user supplies it, the new Project
    // row is audit-traceable to the uploaded CompanyDocument (testimony
    // letter, contract, etc.) it was derived from. Earlier the field was
    // never set on manual creation, so manually entered projects had no
    // provenance link back to their source document.
    let sourceDocumentId: string | null = null;
    if (typeof body.sourceDocumentId === "string" && body.sourceDocumentId.trim()) {
      const docId = body.sourceDocumentId.trim();
      const doc = await prisma.companyDocument.findFirst({
        where: { id: docId, companyId: company.id },
        select: { id: true },
      });
      if (!doc) {
        return NextResponse.json({ error: "sourceDocumentId does not reference a document in your Company Vault." }, { status: 400 });
      }
      sourceDocumentId = doc.id;
    }
    const project = await prisma.project.create({
      data: {
        companyId: company.id,
        name: String(body.name).trim(),
        clientName: body.clientName || null,
        country: body.country || null,
        sector: body.sector || null,
        serviceAreas: toJsonArray(body.serviceAreas),
        summary: body.summary || null,
        contractValue,
        currency: body.currency || null,
        trustLevel: "REVIEWED",
        reviewedBy: actor.id,
        reviewedAt: new Date(),
        reviewNotes: "Manual project record created by authenticated user.",
        sourceDocumentId,
      },
    });

    // ─── Auto-extract project facts (May-7 gap fix) ───────────────────────
    // Section B project cards used to render "Scale on file" / "Dates on
    // file" / "Value detail in Appendix B" because contractValue, currency,
    // country, startDate, endDate, sector were never populated. We now
    // run the regex extractor over the just-created project's summary
    // and fill ONLY the empty columns. Idempotent and never overwrites
    // user-entered values.
    if (project.summary && project.summary.trim().length > 50) {
      try {
        const { extractProjectFacts, mergeProjectFacts } = await import("../../../../lib/engine/project-fact-extractor");
        const extracted = extractProjectFacts(project.summary, project.name);
        const update = mergeProjectFacts(project, extracted);
        if (Object.keys(update).length > 0) {
          await prisma.project.update({ where: { id: project.id }, data: update });
        }
      } catch (eErr) {
        logger.warn("[project-fact-extractor] auto-extraction failed:", { detail: eErr instanceof Error ? eErr.message : eErr });
      }
    }

    const refreshed = await prisma.project.findUnique({ where: { id: project.id } });

    await logAction({
      userId: actor.id,
      action: "PROJECT_CREATE",
      entityType: "Project",
      entityId: project.id,
      description: `Project "${project.name}" created`,
      metadata: { projectId: project.id, name: project.name, companyId: company.id },
    });

    return NextResponse.json(normalizeProject((refreshed ?? project) as unknown as Record<string, unknown>), { status: 201 });
  } catch (error) {
    logger.error("Request failed", { detail: error });
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}
