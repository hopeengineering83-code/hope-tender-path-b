import { logger } from "../../../lib/observability";
import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../lib/prisma";
import { getSession, requireRoleOrRespond } from "../../../lib/auth";
import { logAction } from "../../../lib/audit";
import { API_RATE_LIMIT, MUTATION_RATE_LIMIT, rateLimit, rateLimitPersistent } from "../../../lib/rate-limit";
import { parseTenderStatus } from "../../../lib/tender-workflow";
import { cleanClientName, cleanTenderTitle } from "../../../lib/engine/proposal-labels";
import { extractRequestId } from "../../../lib/request-id";

export async function GET(req: Request) {
  const userId = await getSession();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`tender-list:${userId}`, API_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { error: "Rate limit exceeded", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
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
      files: {
        orderBy: { createdAt: "desc" },
        select: { id: true, fileName: true, originalFileName: true, mimeType: true, size: true, classification: true, createdAt: true },
      },
      requirements: { select: { id: true, title: true, requirementType: true, priority: true, createdAt: true } },
      complianceGaps: { select: { id: true, title: true, severity: true, isResolved: true } },
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
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
  const authResult = await requireRoleOrRespond("ADMIN", "PROPOSAL_MANAGER");
  if (authResult instanceof Response) return authResult;
  const actor = authResult;

  const requestId = extractRequestId(req);
  const rl = await rateLimitPersistent(`tender-create:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many tender creation requests. Wait and retry.", code: "RATE_LIMITED", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  await prismaReady;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    if (!body.title || String(body.title).trim().length === 0) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    if (String(body.title).trim().length > 500) {
      return NextResponse.json({ error: "title must be 500 characters or fewer" }, { status: 400 });
    }
    if (body.description && String(body.description).length > 10_000) {
      return NextResponse.json({ error: "description must be 10,000 characters or fewer" }, { status: 400 });
    }
    if (body.budget !== undefined && body.budget !== null) {
      const parsedBudget = parseFloat(body.budget);
      if (!Number.isFinite(parsedBudget) || parsedBudget < 0 || parsedBudget > 1e12) {
        return NextResponse.json({ error: "budget must be a finite number between 0 and 1,000,000,000,000" }, { status: 400 });
      }
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
        currency: body.currency || null,
        deadline: body.deadline ? new Date(body.deadline) : null,
        submissionMethod: body.submissionMethod || null,
        submissionAddress: body.submissionAddress || null,
        intakeSummary,
        notes: body.notes || null,
        status: "DRAFT",
        stage: "TENDER_INTAKE",
        userId: actor.id,
      },
      include: {
        files: { select: { id: true, fileName: true, originalFileName: true, mimeType: true, size: true, classification: true, createdAt: true } },
        requirements: true,
        complianceGaps: true,
        generatedDocuments: { select: { id: true, name: true, documentType: true, generationStatus: true, validationStatus: true, reviewStatus: true, exactFileName: true, exactOrder: true } },
      },
    });

    void logAction({
      userId: actor.id,
      action: "TENDER_CREATE",
      entityType: "Tender",
      entityId: tender.id,
      description: `Tender "${tender.title}" created`,
      metadata: { tenderId: tender.id, clientName: tender.clientName, category: tender.category },
      requestId,
    }).catch((error) => {
      logger.warn("tender creation audit persistence failed", {
        requestId,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
    });

    return NextResponse.json(tender, { status: 201 });
  } catch (error) {
    logger.error("Tender creation failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "Failed to create tender", code: "TENDER_CREATE_FAILED", requestId },
      { status: 500 },
    );
  }
}
