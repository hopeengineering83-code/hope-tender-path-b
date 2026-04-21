import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../lib/prisma";
import { getSession } from "../../../lib/auth";

function splitCsv(value: unknown) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function GET() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const company = await prisma.company.findUnique({
    where: { userId },
    include: {
      documents: { orderBy: { createdAt: "desc" }, take: 10 },
      experts: { orderBy: { createdAt: "desc" }, take: 10 },
      projects: { orderBy: { createdAt: "desc" }, take: 10 },
      assets: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });

  return NextResponse.json(company);
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
        knowledgeMode: body.knowledgeMode || "PROFILE_FIRST",
        serviceLines: splitCsv(body.serviceLines),
        sectors: splitCsv(body.sectors),
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
        knowledgeMode: body.knowledgeMode || "PROFILE_FIRST",
        serviceLines: splitCsv(body.serviceLines),
        sectors: splitCsv(body.sectors),
        profileSummary: body.profileSummary || null,
      },
      include: {
        documents: { orderBy: { createdAt: "desc" }, take: 10 },
        experts: { orderBy: { createdAt: "desc" }, take: 10 },
        projects: { orderBy: { createdAt: "desc" }, take: 10 },
        assets: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    });

    return NextResponse.json(company);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to save company" }, { status: 500 });
  }
}
