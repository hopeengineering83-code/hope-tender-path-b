// Why a manual Run Engine did not start.
//
// engine/route.ts now writes a TENDER_ENGINE_RUN_REFUSED audit row on every
// pre-enqueue refusal, carrying the refusal code, HTTP status, nextAction and
// the diagnosticId the owner saw. That row exists — but the owner-facing
// /api/audit feed deliberately scrubs descriptions to canned text and drops
// metadata entirely (lib/audit-log-presentation.ts), which is correct for a
// feed shown to end users and useless for diagnosis. A record nobody can read
// is still a silent failure.
//
// This is the diagnostic read: ADMIN only, one tender at a time, returning the
// persisted detail verbatim. It reads; it never writes.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";

export const dynamic = "force-dynamic";

type RefusalMetadata = {
  code?: unknown;
  httpStatus?: unknown;
  nextAction?: unknown;
  error?: unknown;
  diagnosticId?: unknown;
};

function parseMetadata(raw: string | null): RefusalMetadata {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as RefusalMetadata) : {};
  } catch {
    return {};
  }
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
  const tenderId = searchParams.get("tenderId")?.trim() || undefined;
  const limitParam = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(100, limitParam) : 25;

  const rows = await prisma.auditLog.findMany({
    where: {
      userId: actor.id,
      action: "TENDER_ENGINE_RUN_REFUSED",
      ...(tenderId ? { entityId: tenderId } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: { id: true, entityId: true, description: true, metadata: true, createdAt: true },
  });

  const refusals = rows.map((row) => {
    const meta = parseMetadata(row.metadata);
    return {
      id: row.id,
      tenderId: row.entityId,
      createdAt: row.createdAt.toISOString(),
      description: row.description,
      code: typeof meta.code === "string" ? meta.code : null,
      httpStatus: typeof meta.httpStatus === "number" ? meta.httpStatus : null,
      nextAction: typeof meta.nextAction === "string" ? meta.nextAction : null,
      error: typeof meta.error === "string" ? meta.error : null,
      diagnosticId: typeof meta.diagnosticId === "string" ? meta.diagnosticId : null,
    };
  });

  return NextResponse.json({
    success: true,
    actor: { id: actor.id, role: actor.role },
    query: { tenderId: tenderId ?? null, limit },
    count: refusals.length,
    // An empty list is a real answer: either no Run Engine was refused for this
    // tender, or the click never reached the server at all. Those are different
    // problems, so the caller is told which question this answers.
    meaning: refusals.length === 0
      ? "No Run Engine refusal has been recorded for this tender. Either no click reached the server, or every click that did was accepted and enqueued a job."
      : "Each row is a Run Engine request the server refused before enqueuing any job.",
    refusals,
  });
}
