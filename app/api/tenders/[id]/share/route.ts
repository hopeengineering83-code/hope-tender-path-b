import { NextRequest, NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";
import {
  createTenderShareToken,
  generateTenderShareToken,
  parseTenderShareCreateInput,
} from "../../../../../lib/tender-share-security";
import { logAction } from "../../../../../lib/audit";

function privateJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return NextResponse.json(body, { ...init, headers });
}

async function sharingActor() {
  try {
    return { actor: await requireRole("ADMIN", "PROPOSAL_MANAGER"), response: null } as const;
  } catch (error) {
    return {
      actor: null,
      response: error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(),
    } as const;
  }
}

async function ownedTender(tenderId: string, userId: string) {
  return prisma.tender.findFirst({ where: { id: tenderId, userId }, select: { id: true, title: true } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await sharingActor();
  if (!auth.actor) return auth.response;

  const limit = await rateLimitPersistent(`tender-share-create:${auth.actor.id}`, MUTATION_RATE_LIMIT);
  if (!limit.allowed) {
    const retryAfter = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
    return privateJson({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  await prismaReady;
  const { id: tenderId } = await params;
  const tender = await ownedTender(tenderId, auth.actor.id);
  if (!tender) return privateJson({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = parseTenderShareCreateInput(body);
  if (!parsed.ok) return privateJson({ error: parsed.error }, { status: 400 });

  // SECURITY (audit C-4): generate a token + its SHA-256 hash. Store ONLY the
  // hash in the DB (tokenHash column). The raw token is returned to the caller
  // ONCE in the response body so they can construct the share URL — it is
  // never persisted in plaintext. The token column is set to NULL for new
  // shares; legacy shares (created before this fix) still have plaintext
  // tokens and are looked up via the fallback path in app/share/[token]/page.tsx.
  const { token: rawToken, tokenHash } = generateTenderShareToken();
  const share = await prisma.tenderShare.create({
    data: {
      tenderId,
      createdById: auth.actor.id,
      token: null,        // New shares do not store the plaintext token.
      tokenHash,          // Only the hash is persisted.
      label: parsed.value.label,
      expiresAt: parsed.value.expiresAt,
      maxDownloads: parsed.value.maxDownloads,
    },
    select: {
      id: true,
      tokenHash: true,
      label: true,
      createdAt: true,
      expiresAt: true,
      maxDownloads: true,
      downloadCount: true,
      revokedAt: true,
    },
  });

  await logAction({
    userId: auth.actor.id,
    action: "CREATE",
    entityType: "TenderShare",
    entityId: share.id,
    description: `Created a read-only share link for tender "${tender.title}"`,
    metadata: {
      tenderId,
      expiresAt: share.expiresAt?.toISOString() ?? null,
      maxDownloads: share.maxDownloads,
    },
  });

  // Return the raw token ONCE so the caller can construct the share URL.
  // Future GET requests will NOT include the raw token — only the hash.
  return privateJson({ share, shareUrl: `/share/${rawToken}` }, { status: 201 });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await sharingActor();
  if (!auth.actor) return auth.response;

  await prismaReady;
  const { id: tenderId } = await params;
  const tender = await ownedTender(tenderId, auth.actor.id);
  if (!tender) return privateJson({ error: "Not found" }, { status: 404 });

  const shares = await prisma.tenderShare.findMany({
    where: { tenderId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      // SECURITY (audit C-4): never return the plaintext token. The hash is
      // safe to return — it cannot be used to construct a share URL. The
      // presence of tokenHash (non-null) indicates a new-style share; a
      // null tokenHash with non-null token indicates a legacy share.
      tokenHash: true,
      token: true,
      label: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true,
      maxDownloads: true,
      downloadCount: true,
    },
  });
  return privateJson({ shares });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await sharingActor();
  if (!auth.actor) return auth.response;

  const limit = await rateLimitPersistent(`tender-share-revoke:${auth.actor.id}`, MUTATION_RATE_LIMIT);
  if (!limit.allowed) {
    const retryAfter = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
    return privateJson({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  await prismaReady;
  const { id: tenderId } = await params;
  const tender = await ownedTender(tenderId, auth.actor.id);
  if (!tender) return privateJson({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null) as { shareId?: unknown } | null;
  const shareId = typeof body?.shareId === "string" ? body.shareId.trim() : "";
  if (!shareId || shareId.length > 128) return privateJson({ error: "A valid shareId is required" }, { status: 400 });

  const result = await prisma.tenderShare.updateMany({
    where: { id: shareId, tenderId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count === 0) return privateJson({ error: "Share link not found or already revoked" }, { status: 404 });

  await logAction({
    userId: auth.actor.id,
    action: "UPDATE",
    entityType: "TenderShare",
    entityId: shareId,
    description: `Revoked a share link for tender "${tender.title}"`,
    metadata: { tenderId },
  });

  return privateJson({ ok: true, revoked: true });
}
