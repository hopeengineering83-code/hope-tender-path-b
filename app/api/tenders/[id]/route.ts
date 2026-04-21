import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/auth";
import { parseTenderStatus } from "../../../../lib/tender-workflow";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;

  const tender = await prisma.tender.findFirst({
    where: { id, userId },
    include: {
      files: { orderBy: { createdAt: "desc" } },
      requirements: { orderBy: { createdAt: "asc" } },
      complianceGaps: { orderBy: { createdAt: "desc" } },
      generatedDocuments: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!tender) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(tender);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;
  const existing = await prisma.tender.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const body = await req.json();
    const status = parseTenderStatus(body.status);

    const tender = await prisma.tender.update({
      where: { id },
      data: {
        title: body.title ?? existing.title,
        description: body.description ?? existing.description,
        reference: body.reference ?? existing.reference,
        clientName: body.clientName ?? existing.clientName,
        category: body.category ?? existing.category,
        budget:
          body.budget !== undefined
            ? body.budget
              ? parseFloat(body.budget)
              : null
            : existing.budget,
        currency: body.currency ?? existing.currency,
        deadline:
          body.deadline !== undefined
            ? body.deadline
              ? new Date(body.deadline)
              : null
            : existing.deadline,
        submissionMethod: body.submissionMethod ?? existing.submissionMethod,
        submissionAddress: body.submissionAddress ?? existing.submissionAddress,
        intakeSummary: body.intakeSummary ?? existing.intakeSummary,
        analysisSummary: body.analysisSummary ?? existing.analysisSummary,
        notes: body.notes ?? existing.notes,
        status: status ?? existing.status,
        updatedAt: new Date(),
      },
      include: {
        files: { orderBy: { createdAt: "desc" } },
        requirements: { orderBy: { createdAt: "asc" } },
        complianceGaps: { orderBy: { createdAt: "desc" } },
        generatedDocuments: { orderBy: { createdAt: "desc" } },
      },
    });

    return NextResponse.json(tender);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to update tender" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;
  const existing = await prisma.tender.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.tender.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
