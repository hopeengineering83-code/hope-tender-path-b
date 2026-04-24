import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const { id } = await params;
  const tender = await prisma.tender.findFirst({
    where: { id, userId },
    include: { requirements: true },
  });
  if (!tender) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const copy = await prisma.tender.create({
    data: {
      userId,
      title: `${tender.title} (Copy)`,
      description: tender.description,
      reference: tender.reference ? `${tender.reference}-COPY` : null,
      clientName: tender.clientName,
      category: tender.category,
      country: tender.country,
      budget: tender.budget,
      currency: tender.currency,
      submissionMethod: tender.submissionMethod,
      submissionAddress: tender.submissionAddress,
      status: "DRAFT",
      stage: "TENDER_INTAKE",
      intakeSummary: tender.intakeSummary,
      notes: tender.notes,
      exactFileOrder: "[]",
      exactFileNaming: "[]",
      readinessScore: 0,
    },
  });

  await logAction({
    userId,
    action: "TENDER_DUPLICATE",
    entityType: "Tender",
    entityId: copy.id,
    description: `Duplicated tender "${tender.title}" → "${copy.title}"`,
  });

  return NextResponse.json(copy, { status: 201 });
}
