import { logger } from "../../../../lib/observability";
import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { requireRole, forbiddenResponse, unauthorizedResponse, getSession } from "../../../../lib/auth";
import { logAction } from "../../../../lib/audit";
import { MUTATION_RATE_LIMIT, rateLimit } from "../../../../lib/rate-limit";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";

function toJsonArray(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.filter(Boolean));
  return JSON.stringify(
    String(value || "").split(",").map((v) => v.trim()).filter(Boolean)
  );
}

function safeParseArr(v: unknown): string[] {
  try { return JSON.parse(v as string) as string[]; } catch { return []; }
}

function normalizeExpert(e: Record<string, unknown>) {
  return {
    ...e,
    disciplines: safeParseArr(e.disciplines),
    sectors: safeParseArr(e.sectors),
    certifications: safeParseArr(e.certifications),
  };
}

export async function GET(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "100"), 200);
  const cursor = searchParams.get("cursor") ?? undefined;
  const trustLevel = searchParams.get("trustLevel") ?? undefined;
  const q = searchParams.get("q") ?? "";

  const company = await ensureCompanyForUser(prisma, userId);

  const experts = await prisma.expert.findMany({
    where: {
      companyId: company.id,
      deletedAt: null,
      ...(trustLevel ? { trustLevel } : {}),
      ...(q ? { OR: [{ fullName: { contains: q } }, { title: { contains: q } }] } : {}),
    },
    orderBy: [{ trustLevel: "asc" }, { createdAt: "desc" }],
    take: limit + 1,
    select: { id: true, fullName: true, title: true, yearsExperience: true, disciplines: true, sectors: true, certifications: true, trustLevel: true, createdAt: true },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = experts.length > limit;
  const items = hasMore ? experts.slice(0, limit) : experts;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return NextResponse.json({ items: items.map(normalizeExpert), nextCursor, hasMore });
}

export async function POST(req: Request) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const rl = rateLimit(`expert-create:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many expert creation requests. Wait and retry.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
  }

  await prismaReady;
  const company = await ensureCompanyForUser(prisma, actor.id);

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    if (!body.fullName || String(body.fullName).trim().length < 2) {
      return NextResponse.json({ error: "fullName is required" }, { status: 400 });
    }
    const yearsExp = body.yearsExperience != null ? Number(body.yearsExperience) : null;
    if (yearsExp !== null && (yearsExp < 0 || yearsExp > 70)) {
      return NextResponse.json({ error: "yearsExperience must be between 0 and 70" }, { status: 400 });
    }
    // Optional sourceDocumentId — when the user supplies it, the new Expert
    // row is audit-traceable to the uploaded CompanyDocument it was derived
    // from. Earlier the field was never set on manual creation, so manually
    // entered experts had no provenance link back to their source CV.
    let sourceDocumentId: string | null = null;
    if (typeof body.sourceDocumentId === "string" && body.sourceDocumentId.trim()) {
      const docId = body.sourceDocumentId.trim();
      // Validate that the document exists AND belongs to the same company —
      // prevents cross-tenant provenance injection.
      const doc = await prisma.companyDocument.findFirst({
        where: { id: docId, companyId: company.id },
        select: { id: true },
      });
      if (!doc) {
        return NextResponse.json({ error: "sourceDocumentId does not reference a document in your Company Vault." }, { status: 400 });
      }
      sourceDocumentId = doc.id;
    }
    const expert = await prisma.expert.create({
      data: {
        companyId: company.id,
        fullName: String(body.fullName).trim(),
        title: body.title || null,
        email: body.email || null,
        phone: body.phone || null,
        yearsExperience: yearsExp,
        disciplines: toJsonArray(body.disciplines),
        sectors: toJsonArray(body.sectors),
        certifications: toJsonArray(body.certifications),
        profile: body.profile || null,
        trustLevel: "REVIEWED",
        reviewedBy: actor.id,
        reviewedAt: new Date(),
        reviewNotes: "Manual expert record created by authenticated user.",
        sourceDocumentId,
      },
    });

    await logAction({
      userId: actor.id,
      action: "EXPERT_CREATE",
      entityType: "Expert",
      entityId: expert.id,
      description: `Expert "${expert.fullName}" created`,
      metadata: { expertId: expert.id, fullName: expert.fullName, companyId: company.id },
    });

    return NextResponse.json(normalizeExpert(expert as unknown as Record<string, unknown>), { status: 201 });
  } catch (error) {
    logger.error("Request failed", { detail: error });
    return NextResponse.json({ error: "Failed to create expert" }, { status: 500 });
  }
}
