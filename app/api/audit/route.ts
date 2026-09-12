import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";
import { groupAuditLogs, isSafeAuditAction } from "../../../lib/audit-log-presentation";

const INTERNAL_AUDIT_ENTITY_TYPE = "TenderStorageCleanup";

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(req: Request) {
  let actor;
  try {
    actor = await requireRole("ADMIN");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }
  await prismaReady;

  const { searchParams } = new URL(req.url);
  const page = positiveInteger(searchParams.get("page"), 1);
  const limit = Math.min(50, positiveInteger(searchParams.get("limit"), 30));
  const requestedAction = searchParams.get("action")?.trim() || undefined;
  if (requestedAction && !isSafeAuditAction(requestedAction)) {
    return NextResponse.json({ error: "Unsupported activity filter" }, { status: 400 });
  }
  const action = requestedAction;
  const entityType = searchParams.get("entityType")?.trim() || undefined;

  const where = {
    userId: actor.id,
    NOT: { entityType: INTERNAL_AUDIT_ENTITY_TYPE },
    ...(action ? { action } : {}),
    ...(entityType ? { entityType } : {}),
  };

  const [rawLogs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      select: {
        id: true,
        action: true,
        entityType: true,
        description: true,
        createdAt: true,
      },
      // Two-key order: createdAt ties are possible under load, and an
      // unstable order across pages can duplicate or drop rows at page
      // boundaries. The id tiebreaker makes pagination deterministic.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  const logs = groupAuditLogs(rawLogs);
  return NextResponse.json({
    logs,
    total,
    page,
    limit,
    groupedOnPage: rawLogs.length - logs.length,
  });
}
