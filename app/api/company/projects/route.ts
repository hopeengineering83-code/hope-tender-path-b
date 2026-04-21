import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/auth";

export async function GET() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return NextResponse.json([], { status: 200 });

  const projects = await prisma.project.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(projects);
}

export async function POST(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return NextResponse.json({ error: "Company profile required" }, { status: 400 });

  try {
    const body = await req.json();
    const project = await prisma.project.create({
      data: {
        companyId: company.id,
        name: body.name,
        clientName: body.clientName || null,
        country: body.country || null,
        sector: body.sector || null,
        serviceAreas: Array.isArray(body.serviceAreas)
          ? body.serviceAreas.filter(Boolean)
          : String(body.serviceAreas || "").split(",").map((v) => v.trim()).filter(Boolean),
        summary: body.summary || null,
        contractValue: body.contractValue ? Number(body.contractValue) : null,
        currency: body.currency || null,
      },
    });

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}
