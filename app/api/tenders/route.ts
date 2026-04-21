import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../lib/prisma";
import { getSession } from "../../../lib/auth";
import { parseTenderStatus } from "../../../lib/tender-workflow";

export async function GET(req: Request) {
  const userId = await getSession();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prismaReady;
  const { searchParams } = new URL(req.url);
  const status = parseTenderStatus(searchParams.get("status") || undefined);
  const q = searchParams.get("q") || "";

  const tenders = await prisma.tender.findMany({
    where: {
      userId,
      ...(status ? { status } : {}),
      ...(q ? { OR: [{ title: { contains: q } }, { reference: { contains: q } }, { clientName: { contains: q } }] } : {}),
    },
    include: {
      files: { orderBy: { createdAt: "desc" } },
      requirements: true,
      complianceGaps: true,
      generatedDocuments: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(tenders);
}

export async function POST(req: Request) {
  const userId = await getSession();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prismaReady;

  try {
    const body = await req.json();
    const intakeSummary = body.intakeSummary || body.requirements || null;
    const tender = await prisma.tender.create({
      data: {
        id: crypto.randomUUID(),
        title: body.title,
        description: body.description || null,
        reference: body.reference || null,
        clientName: body.clientName || null,
        category: body.category || "General",
        budget: body.budget ? parseFloat(body.budget) : null,
        currency: body.currency || "USD",
        deadline: body.deadline ? new Date(body.deadline) : null,
        submissionMethod: body.submissionMethod || null,
        submissionAddress: body.submissionAddress || null,
        intakeSummary,
        notes: body.notes || null,
        status: "DRAFT",
        stage: "TENDER_INTAKE",
        userId,
      },
      include: {
        files: true,
        requirements: true,
        complianceGaps: true,
        generatedDocuments: true,
      },
    });

    return NextResponse.json(tender, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to create tender" }, { status: 500 });
  }
}
