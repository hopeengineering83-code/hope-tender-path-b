import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/auth";
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

function normalizeProject(p: Record<string, unknown>) {
  return { ...p, serviceAreas: safeParseArr(p.serviceAreas) };
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

  const projects = await prisma.project.findMany({
    where: {
      companyId: company.id,
      deletedAt: null,
      ...(trustLevel ? { trustLevel } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { clientName: { contains: q } }, { sector: { contains: q } }] } : {}),
    },
    orderBy: [{ trustLevel: "asc" }, { createdAt: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = projects.length > limit;
  const items = hasMore ? projects.slice(0, limit) : projects;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return NextResponse.json({ items: items.map(normalizeProject), nextCursor, hasMore });
}

export async function POST(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const company = await ensureCompanyForUser(prisma, userId);

  try {
    const body = await req.json();
    const project = await prisma.project.create({
      data: {
        companyId: company.id,
        name: body.name,
        clientName: body.clientName || null,
        country: body.country || null,
        sector: body.sector || null,
        serviceAreas: toJsonArray(body.serviceAreas),
        summary: body.summary || null,
        contractValue: body.contractValue ? Number(body.contractValue) : null,
        currency: body.currency || null,
        trustLevel: "REVIEWED",
        reviewedBy: userId,
        reviewedAt: new Date(),
        reviewNotes: "Manual project record created by authenticated user.",
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
        console.warn("[project-fact-extractor] auto-extraction failed:", eErr instanceof Error ? eErr.message : eErr);
      }
    }

    const refreshed = await prisma.project.findUnique({ where: { id: project.id } });
    return NextResponse.json(normalizeProject((refreshed ?? project) as unknown as Record<string, unknown>), { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}
