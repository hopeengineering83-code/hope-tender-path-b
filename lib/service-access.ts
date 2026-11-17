// Revocable, tenant-bound, read-only service access (first client: HOPE ONE AGENT).
//
// A ServiceAccessGrant belongs to exactly one user — the tenant. A request that presents its
// token can read ONLY that user's tenders, ONLY through the read-only status route, and ONLY the
// minimal fields in TENDER_STATUS_SELECT: no client names or contacts, budgets, pricing, notes,
// summaries, files, documents, job inputs/outputs or error text ever leave through this path.
//
// Tokens: "hsa_" + 32 random bytes (base64url, 256 bits). Only SHA-256(token) is stored, as for
// TenderShare and password-reset tokens; the raw token is shown to the owner exactly once.
// Every grant has a fixed audience and scope (also enforced by database CHECK constraints), a
// mandatory expiry of at most 90 days, and can be revoked at once. It does not reuse, and cannot
// be exchanged for, a browser session, the cron/worker secrets or any database credential, and it
// cannot reach AI Analyze, Run Engine or any write route: those keep their own session/role and
// manual-authority checks.
import { createHash, randomBytes } from "crypto";
import { logAction } from "./audit";
import { prisma, prismaReady } from "./prisma";
import { rateLimitPeek, rateLimitPersistent, type RateLimitConfig } from "./rate-limit";
import { getClientIp } from "./request-ip";

export const SERVICE_AUDIENCE = "hope-one-agent";
export const SERVICE_SCOPE_TENDER_STATUS = "tenders:status:read";
export const SERVICE_GRANT_MAX_DAYS = 90;
export const SERVICE_GRANT_DEFAULT_DAYS = 30;
export const SERVICE_GRANT_MAX_ACTIVE_PER_USER = 5;
export const SERVICE_TENDER_LIMIT = 50;
const TOKEN_PATTERN = /^hsa_[A-Za-z0-9_-]{43}$/;
const LABEL_MAX = 120;
// Order of the limits (authenticateServiceRequest):
//   1. SERVICE_PREAUTH_RATE_LIMIT, per client address, on every request: one durable bucket per
//      address, never per presented token, before anything token-specific is written or looked up.
//   2. SERVICE_DENIED_RATE_LIMIT, refused attempts per client address: checked read-only before the
//      grant lookup and counted after a refusal, so an address that keeps presenting unknown tokens
//      gets no further lookups until its window ends.
//   3. SERVICE_READ_RATE_LIMIT, per GRANT (by id), only after a usable grant was found: only real
//      grants ever get a bucket, so rotating invented tokens cannot create durable rows.
// The client address comes from lib/request-ip.ts: on Vercel, x-forwarded-for is set by Vercel
// itself, which overwrites any value a client sends; elsewhere it is ignored unless TRUST_PROXY=true.
export const SERVICE_PREAUTH_RATE_LIMIT: RateLimitConfig = { limit: 30, windowMs: 60_000 };
export const SERVICE_DENIED_RATE_LIMIT: RateLimitConfig = { limit: 20, windowMs: 10 * 60_000 };
export const SERVICE_READ_RATE_LIMIT: RateLimitConfig = { limit: 30, windowMs: 60_000 };
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

export type GeneratedServiceToken = { token: string; tokenHash: string };

export function generateServiceToken(): GeneratedServiceToken {
  const token = `hsa_${randomBytes(32).toString("base64url")}`;
  return { token, tokenHash: hashServiceToken(token) };
}

export function hashServiceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The token from "Authorization: Bearer hsa_…", or null when the header is absent or malformed. */
export function parseServiceBearer(header: string | null): string | null {
  if (!header || header.length > 200) return null;
  const match = /^Bearer (\S+)$/.exec(header);
  return match && TOKEN_PATTERN.test(match[1]) ? match[1] : null;
}

export type GrantCreateInput = { label: string | null; days: number };

export function parseGrantCreateInput(value: unknown):
  | { ok: true; value: GrantCreateInput }
  | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Request body must be a JSON object" };
  }
  const body = value as Record<string, unknown>;
  const unknownKeys = Object.keys(body).filter((key) => key !== "label" && key !== "days");
  if (unknownKeys.length) return { ok: false, error: "Unexpected fields" };
  let label: string | null = null;
  if (body.label !== undefined && body.label !== null) {
    if (typeof body.label !== "string") return { ok: false, error: "label must be text" };
    const cleaned = body.label.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (cleaned.length > LABEL_MAX) return { ok: false, error: `label must be at most ${LABEL_MAX} characters` };
    label = cleaned || null;
  }
  let days = SERVICE_GRANT_DEFAULT_DAYS;
  if (body.days !== undefined) {
    if (typeof body.days !== "number" || !Number.isInteger(body.days) || body.days < 1 || body.days > SERVICE_GRANT_MAX_DAYS) {
      return { ok: false, error: `days must be a whole number from 1 to ${SERVICE_GRANT_MAX_DAYS}` };
    }
    days = body.days;
  }
  return { ok: true, value: { label, days } };
}

export type GrantView = {
  id: string; label: string | null; audience: string; scope: string; createdAt: string; expiresAt: string;
  revokedAt: string | null; lastUsedAt: string | null; useCount: number; active: boolean;
};

export function grantView(grant: {
  id: string; label: string | null; audience: string; scope: string; createdAt: Date; expiresAt: Date;
  revokedAt: Date | null; lastUsedAt: Date | null; useCount: number;
}, now = new Date()): GrantView {
  return {
    id: grant.id, label: grant.label, audience: grant.audience, scope: grant.scope,
    createdAt: grant.createdAt.toISOString(), expiresAt: grant.expiresAt.toISOString(),
    revokedAt: grant.revokedAt?.toISOString() ?? null, lastUsedAt: grant.lastUsedAt?.toISOString() ?? null,
    useCount: grant.useCount, active: !grant.revokedAt && grant.expiresAt > now,
  };
}

export type ServiceAuthResult =
  | { ok: true; grantId: string; userId: string; expiresAt: Date }
  | { ok: false; status: 401 | 403 | 429; error: string; retryAfter?: number };

function denied(status: 401 | 403 | 429, error: string, retryAfter?: number): ServiceAuthResult {
  return { ok: false, status, error, retryAfter };
}

function tooMany(resetAt: number): ServiceAuthResult {
  return denied(429, "Too many requests", Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)));
}

/** A refused attempt: counted against the client address, answered with the same 401 every time. */
async function refuse(address: string): Promise<ServiceAuthResult> {
  const limited = await rateLimitPersistent(`service-denied:${address}`, SERVICE_DENIED_RATE_LIMIT);
  if (!limited.allowed) return tooMany(limited.resetAt);
  return denied(401, "Service authorization required");
}

/**
 * Authenticate a service request for `scope`. Fail-closed: a missing, malformed, unknown,
 * revoked or expired token, a deleted tenant, or a grant without this scope/audience is refused.
 * The error text never says which of those it was (no oracle for token probing).
 */
export async function authenticateServiceRequest(req: Request, scope: string, now = new Date()): Promise<ServiceAuthResult> {
  const address = getClientIp(req);
  // 1. Pre-authentication, per client address: nothing token-specific is written or read before it.
  const preauth = await rateLimitPersistent(`service-preauth:${address}`, SERVICE_PREAUTH_RATE_LIMIT);
  if (!preauth.allowed) return tooMany(preauth.resetAt);
  // 2. An address that already used up its refused attempts gets no lookup at all (read-only check).
  const refusals = await rateLimitPeek(`service-denied:${address}`, SERVICE_DENIED_RATE_LIMIT);
  if (refusals.exhausted) return tooMany(refusals.resetAt);
  const token = parseServiceBearer(req.headers.get("authorization"));
  if (!token) return refuse(address);
  await prismaReady;
  const grant = await prisma.serviceAccessGrant.findUnique({
    where: { tokenHash: hashServiceToken(token) },
    select: { id: true, userId: true, audience: true, scope: true, expiresAt: true, revokedAt: true, lastUsedAt: true,
              user: { select: { deletedAt: true } } },
  });
  const usable = grant && !grant.revokedAt && grant.expiresAt > now && !grant.user.deletedAt;
  if (!usable) return refuse(address);
  // 3. Per grant, keyed by its id: only real grants ever get a bucket.
  const perGrant = await rateLimitPersistent(`service-read:${grant.id}`, SERVICE_READ_RATE_LIMIT);
  if (!perGrant.allowed) return tooMany(perGrant.resetAt);
  if (grant.audience !== SERVICE_AUDIENCE || grant.scope !== scope) {
    await logAction({ userId: grant.userId, action: "SERVICE_GRANT_DENIED", entityType: "ServiceAccessGrant",
                      entityId: grant.id, description: "Service grant used outside its scope",
                      metadata: { scope } });
    return denied(403, "This grant does not allow this request");
  }
  // Record use at most once a minute per grant (no write on every poll).
  if (!grant.lastUsedAt || now.getTime() - grant.lastUsedAt.getTime() >= LAST_USED_WRITE_INTERVAL_MS) {
    await prisma.serviceAccessGrant.updateMany({
      where: { id: grant.id, revokedAt: null },
      data: { lastUsedAt: now, useCount: { increment: 1 } },
    });
  }
  return { ok: true, grantId: grant.id, userId: grant.userId, expiresAt: grant.expiresAt };
}

/**
 * The ONLY tender fields the service route may read. Adding a field here is a security change.
 * readinessScore is deliberately absent: the Tender App itself no longer shows it, because the
 * persisted score is not a valid workflow-stage or progress metric (Issue #1134).
 */
export const TENDER_STATUS_SELECT = {
  id: true, title: true, reference: true, status: true, stage: true, deadline: true, updatedAt: true,
} as const;

export type TenderStatusItem = {
  id: string; title: string; reference: string | null; status: string; stage: string;
  deadline: string | null; updatedAt: string;
  latestJob: { type: string; status: string; updatedAt: string } | null;
};

function clip(value: string | null, limit: number): string | null {
  if (value === null) return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return cleaned.length > limit ? `${cleaned.slice(0, limit - 1)}…` : cleaned;
}

/** Minimal status of the tenant's tenders: soonest deadline first, at most SERVICE_TENDER_LIMIT. */
export async function readTenderStatus(userId: string, now = new Date()) {
  await prismaReady;
  const [tenders, total, byStatus] = await Promise.all([
    prisma.tender.findMany({
      where: { userId },
      select: TENDER_STATUS_SELECT,
      orderBy: [{ deadline: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
      take: SERVICE_TENDER_LIMIT,
    }),
    prisma.tender.count({ where: { userId } }),
    prisma.tender.groupBy({ by: ["status"], where: { userId }, _count: { id: true } }),
  ]);
  const ids = tenders.map((tender) => tender.id);
  const jobs = ids.length
    ? await prisma.aiJob.findMany({
        where: { userId, tenderId: { in: ids } },
        select: { tenderId: true, jobType: true, status: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 500,
      })
    : [];
  const latest = new Map<string, { type: string; status: string; updatedAt: string }>();
  for (const job of jobs) {
    if (job.tenderId && !latest.has(job.tenderId)) {
      latest.set(job.tenderId, { type: job.jobType, status: job.status, updatedAt: job.updatedAt.toISOString() });
    }
  }
  const items: TenderStatusItem[] = tenders.map((tender) => ({
    id: tender.id,
    title: clip(tender.title, 160) ?? "",
    reference: clip(tender.reference, 80),
    status: tender.status,
    stage: tender.stage,
    deadline: tender.deadline?.toISOString() ?? null,
    updatedAt: tender.updatedAt.toISOString(),
    latestJob: latest.get(tender.id) ?? null,
  }));
  return {
    generatedAt: now.toISOString(),
    total,
    truncated: total > tenders.length,
    byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count.id])),
    tenders: items,
  };
}
