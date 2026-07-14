import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../lib/request-id";
import { logger } from "../../../../../lib/observability";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  const requestId = extractRequestId(req);
  const rl = rateLimit(`duplicate:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many requests", code: "RATE_LIMITED", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  await prismaReady;
  const { id } = await params;
  const tender = await prisma.tender.findFirst({
    where: { id, userId: actor.id },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const copy = await prisma.tender.create({
    data: {
      userId: actor.id,
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

  // Canonical audit consistency policy: non-fatal. The duplication has
  // already succeeded; a failed audit log must not roll it back or surface
  // a 500 to the user. The audit is persisted best-effort with request
  // correlation so operators can investigate gaps.
  void logAction({
    userId: actor.id,
    action: "TENDER_DUPLICATE",
    entityType: "Tender",
    entityId: copy.id,
    description: `Duplicated tender "${tender.title}" → "${copy.title}"`,
    metadata: { sourceTenderId: tender.id, duplicateTenderId: copy.id },
    requestId,
  }).catch((error) => {
    logger.warn("tender duplicate audit persistence failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
  });

  return NextResponse.json(copy, { status: 201 });
}
