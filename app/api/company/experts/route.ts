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
      ...(trustLevel ? { trustLevel } : {}),
      ...(q ? { OR: [{ fullName: { contains: q } }, { title: { contains: q } }] } : {}),
    },
    orderBy: [{ trustLevel: "asc" }, { createdAt: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = experts.length > limit;
  const items = hasMore ? experts.slice(0, limit) : experts;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return NextResponse.json({ items: items.map(normalizeExpert), nextCursor, hasMore });
}

export async function POST(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const company = await ensureCompanyForUser(prisma, userId);

  try {
    const body = await req.json();
    if (!body.fullName || String(body.fullName).trim().length < 2) {
      return NextResponse.json({ error: "fullName is required" }, { status: 400 });
    }
    const yearsExp = body.yearsExperience != null ? Number(body.yearsExperience) : null;
    if (yearsExp !== null && (yearsExp < 0 || yearsExp > 70)) {
      return NextResponse.json({ error: "yearsExperience must be between 0 and 70" }, { status: 400 });
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
        reviewedBy: userId,
        reviewedAt: new Date(),
        reviewNotes: "Manual expert record created by authenticated user.",
      },
    });

    return NextResponse.json(normalizeExpert(expert as unknown as Record<string, unknown>), { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to create expert" }, { status: 500 });
  }
}
