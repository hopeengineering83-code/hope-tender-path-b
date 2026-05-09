import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../lib/prisma";
import { getSession } from "../../../lib/auth";
import { parseTenderStatus } from "../../../lib/tender-workflow";
import { cleanClientName, cleanTenderTitle } from "../../../lib/engine/proposal-labels";

export async function GET(req: Request) {
  const userId = await getSession();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prismaReady;
  const { searchParams } = new URL(req.url);
  const status = parseTenderStatus(searchParams.get("status") || undefined);
  const q = searchParams.get("q") || "";

  const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 200);
  const cursor = searchParams.get("cursor") ?? undefined;

  const tenders = await prisma.tender.findMany({
    where: {
      userId,
      ...(status ? { status } : {}),
      ...(q ? { OR: [{ title: { contains: q } }, { reference: { contains: q } }, { clientName: { contains: q } }] } : {}),
    },
    include: {
      // Exclude fileContent / base64 fields to keep response small
      files: {
        orderBy: { createdAt: "desc" },
        select: { id: true, fileName: true, originalFileName: true, mimeType: true, size: true, classification: true, extractedText: true, createdAt: true },
      },
      requirements: { select: { id: true, title: true, requirementType: true, priority: true, createdAt: true } },
      complianceGaps: { select: { id: true, title: true, severity: true, isResolved: true } },
      generatedDocuments: {
        select: { id: true, name: true, documentType: true, generationStatus: true, validationStatus: true, reviewStatus: true, exactFileName: true, exactOrder: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = tenders.length > limit;
  const items = hasMore ? tenders.slice(0, limit) : tenders;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return NextResponse.json({ items, nextCursor, hasMore });
}

export async function POST(req: Request) {
  const userId = await getSession();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prismaReady;

  try {
    const body = await req.json();
    if (!body.title || String(body.title).trim().length === 0) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    if (body.budget !== undefined && body.budget !== null && parseFloat(body.budget) < 0) {
      return NextResponse.json({ error: "budget cannot be negative" }, { status: 400 });
    }
    const intakeSummary = body.intakeSummary || body.requirements || null;
    const cleanClient = cleanClientName(body.clientName, body.description || intakeSummary || body.title);
    const cleanTitle = cleanTenderTitle(body.title, { clientName: cleanClient, description: body.description || intakeSummary });
    const tender = await prisma.tender.create({
      data: {
        id: crypto.randomUUID(),
        title: cleanTitle,
        description: body.description || null,
        reference: body.reference || null,
        clientName: cleanClient === "Client" ? null : cleanClient,
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
        files: { select: { id: true, fileName: true, originalFileName: true, mimeType: true, size: true, classification: true, extractedText: true, createdAt: true } },
        requirements: true,
        complianceGaps: true,
        generatedDocuments: { select: { id: true, name: true, documentType: true, generationStatus: true, validationStatus: true, reviewStatus: true, exactFileName: true, exactOrder: true } },
      },
    });

    return NextResponse.json(tender, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to create tender" }, { status: 500 });
  }
}
