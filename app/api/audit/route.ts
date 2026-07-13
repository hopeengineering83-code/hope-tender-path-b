import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";

const INTERNAL_AUDIT_ENTITY_TYPE = "TenderStorageCleanup";

export async function GET(req: Request) {
  let actor;
  try {
    actor = await requireRole("ADMIN");
  } catch (e) {
    return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }
  const userId = actor.id;
  await prismaReady;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.min(100, parseInt(searchParams.get("limit") ?? "50"));
  const action = searchParams.get("action") ?? undefined;
  const entityType = searchParams.get("entityType") ?? undefined;

  const where = {
    userId,
    NOT: { entityType: INTERNAL_AUDIT_ENTITY_TYPE },
    ...(action ? { action } : {}),
    ...(entityType ? { entityType } : {}),
  };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      select: { id: true, action: true, entityType: true, entityId: true, description: true, createdAt: true, metadata: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return NextResponse.json({ logs, total, page, limit });
}
