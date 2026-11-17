import { NextResponse, type NextRequest } from "next/server";
import { logAction } from "../../../../../lib/audit";
import { requireRoleOrRespond } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { MUTATION_RATE_LIMIT, rateLimitPersistent } from "../../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

/** DELETE: revoke one of the signed-in user's own grants, effective on the next request. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireRoleOrRespond("ADMIN", "PROPOSAL_MANAGER");
  if (actor instanceof Response) return actor;
  const limit = await rateLimitPersistent(`service-grant-revoke:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!limit.allowed) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prismaReady;
  // Scoped by userId: another user's grant id behaves exactly like a missing one (no oracle).
  const result = await prisma.serviceAccessGrant.updateMany({
    where: { id, userId: actor.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count !== 1) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await logAction({ userId: actor.id, action: "SERVICE_GRANT_REVOKED", entityType: "ServiceAccessGrant",
                    entityId: id, description: "Read-only service grant revoked" });
  return NextResponse.json({ revoked: true }, { headers: { "Cache-Control": "no-store" } });
}
