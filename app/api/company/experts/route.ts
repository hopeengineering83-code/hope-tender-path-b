import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/auth";

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

  return NextResponse.json(experts);
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
        disciplines: Array.isArray(body.disciplines)
          ? body.disciplines.filter(Boolean)
          : String(body.disciplines || "").split(",").map((v) => v.trim()).filter(Boolean),
        sectors: Array.isArray(body.sectors)
          ? body.sectors.filter(Boolean)
          : String(body.sectors || "").split(",").map((v) => v.trim()).filter(Boolean),
        certifications: Array.isArray(body.certifications)
          ? body.certifications.filter(Boolean)
          : String(body.certifications || "").split(",").map((v) => v.trim()).filter(Boolean),
        profile: body.profile || null,
      },
    });

    return NextResponse.json(expert, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to create expert" }, { status: 500 });
  }
}
