import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../lib/prisma";
import { getSession } from "../../../lib/auth";

function toJsonArray(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.filter(Boolean));
  return JSON.stringify(
    String(value || "").split(",").map((v) => v.trim()).filter(Boolean)
  );
}

export async function GET() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const company = await prisma.company.findUnique({
    where: { userId },
    include: {
      experts: { orderBy: { createdAt: "desc" }, take: 10 },
      projects: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });

  if (!company) return NextResponse.json(null);

  return NextResponse.json({
    ...company,
    serviceLines: safeParseArr(company.serviceLines),
    sectors: safeParseArr(company.sectors),
  });
}

function safeParseArr(v: unknown): string[] {
  try { return JSON.parse(v as string) as string[]; } catch { return []; }
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
        name: body.name || "My Company",
        legalName: body.legalName || null,
        description: body.description || null,
        website: body.website || null,
        address: body.address || null,
        phone: body.phone || null,
        email: body.email || null,
        serviceLines: toJsonArray(body.serviceLines),
        sectors: toJsonArray(body.sectors),
        profileSummary: body.profileSummary || null,
        userId,
      },
      update: {
        name: body.name,
        legalName: body.legalName || null,
        description: body.description || null,
        website: body.website || null,
        address: body.address || null,
        phone: body.phone || null,
        email: body.email || null,
        serviceLines: toJsonArray(body.serviceLines),
        sectors: toJsonArray(body.sectors),
        profileSummary: body.profileSummary || null,
      },
      include: {
        experts: { orderBy: { createdAt: "desc" }, take: 10 },
        projects: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    });

    return NextResponse.json({
      ...company,
      serviceLines: safeParseArr(company.serviceLines),
      sectors: safeParseArr(company.sectors),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to save company" }, { status: 500 });
  }
}
