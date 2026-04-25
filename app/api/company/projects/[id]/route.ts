import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getSession } from "../../../../../lib/auth";

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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const { id } = await params;
  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const project = await prisma.project.findFirst({ where: { id, companyId: company.id } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(normalizeProject(project as unknown as Record<string, unknown>));
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const { id } = await params;
  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const existing = await prisma.project.findFirst({ where: { id, companyId: company.id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const body = await req.json() as Record<string, unknown>;
    const updated = await prisma.project.update({
      where: { id },
      data: {
        name: String(body.name ?? existing.name),
        clientName: body.clientName !== undefined ? (String(body.clientName) || null) : existing.clientName,
        country: body.country !== undefined ? (String(body.country) || null) : existing.country,
        sector: body.sector !== undefined ? (String(body.sector) || null) : existing.sector,
        serviceAreas: body.serviceAreas !== undefined ? toJsonArray(body.serviceAreas) : existing.serviceAreas,
        summary: body.summary !== undefined ? (String(body.summary) || null) : existing.summary,
        contractValue: body.contractValue !== undefined
          ? (body.contractValue ? Number(body.contractValue) : null)
          : existing.contractValue,
        currency: body.currency !== undefined ? (String(body.currency) || null) : existing.currency,
        updatedAt: new Date(),
      },
    });
    return NextResponse.json(normalizeProject(updated as unknown as Record<string, unknown>));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
  }
}

/**
 * PATCH — review a project record.
 * Body: { action: "approve" | "reject", notes?: string }
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const { id } = await params;
  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const existing = await prisma.project.findFirst({ where: { id, companyId: company.id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json() as { action?: string; notes?: string };
  if (!body.action || !["approve", "reject"].includes(body.action)) {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  const isApprove = body.action === "approve";
  const updated = await prisma.project.update({
    where: { id },
    data: {
      trustLevel: isApprove ? "REVIEWED" : "AI_DRAFT",
      reviewedBy: userId,
      reviewedAt: new Date(),
      reviewNotes: body.notes ?? null,
      updatedAt: new Date(),
    },
  });
  return NextResponse.json(normalizeProject(updated as unknown as Record<string, unknown>));
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const { id } = await params;
  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const existing = await prisma.project.findFirst({ where: { id, companyId: company.id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.project.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
