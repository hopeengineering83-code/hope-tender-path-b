import { NextResponse, type NextRequest } from "next/server";
import { logAction } from "../../../../lib/audit";
import { requireRoleOrRespond } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { MUTATION_RATE_LIMIT, rateLimitPersistent } from "../../../../lib/rate-limit";
import {
  generateServiceToken,
  grantView,
  parseGrantCreateInput,
  SERVICE_AUDIENCE,
  SERVICE_GRANT_MAX_ACTIVE_PER_USER,
  SERVICE_SCOPE_TENDER_STATUS,
} from "../../../../lib/service-access";

export const dynamic = "force-dynamic";

/** GET: the signed-in user's own service grants (never a token or its hash). */
export async function GET() {
  const actor = await requireRoleOrRespond("ADMIN", "PROPOSAL_MANAGER");
  if (actor instanceof Response) return actor;
  await prismaReady;
  const grants = await prisma.serviceAccessGrant.findMany({
    where: { userId: actor.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, label: true, audience: true, scope: true, createdAt: true, expiresAt: true,
              revokedAt: true, lastUsedAt: true, useCount: true },
  });
  const now = new Date();
  return NextResponse.json({ grants: grants.map((grant) => grantView(grant, now)) },
                           { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST: issue a read-only grant for HOPE ONE AGENT over the signed-in user's own tenders.
 * The token is returned ONCE in this response and never stored (only its SHA-256).
 * Session, role, CSRF (middleware), durable rate limit and audit apply.
 */
export async function POST(req: NextRequest) {
  const actor = await requireRoleOrRespond("ADMIN", "PROPOSAL_MANAGER");
  if (actor instanceof Response) return actor;
  const limit = await rateLimitPersistent(`service-grant-create:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }
  const parsed = parseGrantCreateInput(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  await prismaReady;
  const now = new Date();
  const active = await prisma.serviceAccessGrant.count({
    where: { userId: actor.id, revokedAt: null, expiresAt: { gt: now } },
  });
  if (active >= SERVICE_GRANT_MAX_ACTIVE_PER_USER) {
    return NextResponse.json({ error: `At most ${SERVICE_GRANT_MAX_ACTIVE_PER_USER} active grants; revoke one first` },
                             { status: 409 });
  }
  const { token, tokenHash } = generateServiceToken();
  const grant = await prisma.serviceAccessGrant.create({
    data: {
      userId: actor.id, tokenHash, audience: SERVICE_AUDIENCE, scope: SERVICE_SCOPE_TENDER_STATUS,
      label: parsed.value.label, createdAt: now,
      expiresAt: new Date(now.getTime() + parsed.value.days * 86_400_000),
    },
    select: { id: true, label: true, audience: true, scope: true, createdAt: true, expiresAt: true,
              revokedAt: true, lastUsedAt: true, useCount: true },
  });
  await logAction({ userId: actor.id, action: "SERVICE_GRANT_CREATED", entityType: "ServiceAccessGrant",
                    entityId: grant.id, description: "Read-only service grant issued",
                    metadata: { audience: grant.audience, scope: grant.scope, expiresAt: grant.expiresAt.toISOString() } });
  return NextResponse.json({ grant: grantView(grant, now), token,
                             note: "Copy this token now: it is shown only once and cannot be recovered." },
                           { status: 201, headers: { "Cache-Control": "no-store" } });
}
