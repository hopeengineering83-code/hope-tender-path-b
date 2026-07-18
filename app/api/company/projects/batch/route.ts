import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { ensureCompanyForUser } from "../../../../../lib/company-workspace";
import { logAction } from "../../../../../lib/audit";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../lib/request-id";

export async function PATCH(req: Request) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  const requestId = extractRequestId(req);
  const rl = await rateLimitPersistent(`projects-batch-review:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many requests", code: "RATE_LIMITED", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  await prismaReady;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const ids = Array.from(new Set(
    Array.isArray(body.ids)
      ? body.ids.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim())
      : [],
  ));
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids array is required and must not be empty" }, { status: 400 });
  }
  if (ids.length > 200) {
    return NextResponse.json({ error: "Maximum 200 unique ids per batch" }, { status: 400 });
  }
  if (body.trustLevel !== "REVIEWED") {
    return NextResponse.json(
      { error: "trustLevel must be explicitly set to REVIEWED", code: "INVALID_TRUST_LEVEL" },
      { status: 400 },
    );
  }

  const company = await ensureCompanyForUser(prisma, actor.id);
  const ownedCount = await prisma.project.count({
    where: { id: { in: ids }, companyId: company.id, deletedAt: null },
  });
  if (ownedCount !== ids.length) {
    return NextResponse.json(
      { error: "One or more requested records were not found", code: "RECORD_NOT_FOUND", requestId },
      { status: 404 },
    );
  }

  const result = await prisma.project.updateMany({
    where: { id: { in: ids }, companyId: company.id, deletedAt: null },
    data: {
      trustLevel: "REVIEWED",
      reviewedBy: actor.id,
      reviewedAt: new Date(),
      reviewNotes: "Batch approved by an authorized reviewer.",
    },
  });

  void logAction({
    userId: actor.id,
    action: "UPDATE",
    entityType: "Project",
    description: `Batch approved ${result.count} project(s) as REVIEWED`,
    metadata: { ids, trustLevel: "REVIEWED", updated: result.count },
    requestId,
  }).catch((error) => {
    logger.warn("project batch-review audit persistence failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
  });

  return NextResponse.json({ success: true, updated: result.count });
}
