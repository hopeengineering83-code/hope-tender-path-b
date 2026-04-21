import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/auth";

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

export async function GET() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return NextResponse.json([], { status: 200 });

  const experts = await prisma.expert.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(experts.map(normalizeExpert));
}

export async function POST(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return NextResponse.json({ error: "Company profile required" }, { status: 400 });

  try {
    const body = await req.json();
    const expert = await prisma.expert.create({
      data: {
        companyId: company.id,
        fullName: body.fullName,
        title: body.title || null,
        email: body.email || null,
        phone: body.phone || null,
        yearsExperience: body.yearsExperience ? Number(body.yearsExperience) : null,
        disciplines: toJsonArray(body.disciplines),
        sectors: toJsonArray(body.sectors),
        certifications: toJsonArray(body.certifications),
        profile: body.profile || null,
      },
    });

    return NextResponse.json(normalizeExpert(expert as unknown as Record<string, unknown>), { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to create expert" }, { status: 500 });
  }
}
