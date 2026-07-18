import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";

const INTERNAL_AUDIT_ENTITY_TYPE = "TenderStorageCleanup";
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 30;
const MAX_TEXT_LENGTH = 240;

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boundText(value: string | null | undefined): string {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "Activity recorded";
  return normalized.length > MAX_TEXT_LENGTH ? `${normalized.slice(0, MAX_TEXT_LENGTH - 1)}…` : normalized;
}

function publicEntityType(entityType: string | null): string | null {
  if (!entityType) return null;
  return entityType.replace(/[^a-zA-Z0-9_ -]/g, "").slice(0, 80) || null;
}

function publicAuditLog(row: {
  id: string;
  action: string;
  entityType: string | null;
  description: string | null;
  createdAt: Date;
}) {
  return {
    id: `audit_${row.id.slice(0, 8)}`,
    action: row.action,
    entityType: publicEntityType(row.entityType),
    description: boundText(row.description),
    createdAt: row.createdAt.toISOString(),
  };
}

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
  const page = parsePositiveInt(searchParams.get("page"), 1);
  const requestedLimit = parsePositiveInt(searchParams.get("limit"), DEFAULT_PAGE_SIZE);
  const limit = Math.min(MAX_PAGE_SIZE, requestedLimit);
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
      select: { id: true, action: true, entityType: true, description: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return NextResponse.json({ logs: logs.map(publicAuditLog), total, page, limit });
}
