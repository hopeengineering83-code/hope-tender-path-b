import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { prisma, prismaReady } from "./prisma";
import { logger } from "./observability";

const SESSION_COOKIE = "hope_session";
const SESSION_TTL_DAYS = 14;

type SessionPayload = { userId: string; exp: number; nonce: string };

function getSecret(): string {
  const secret = process.env.SESSION_SECRET ?? process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET or AUTH_SECRET must be configured with at least 32 characters");
  }
  return secret;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function makeToken(userId: string): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400 * 1000);
  const payload: SessionPayload = {
    userId,
    exp: Math.floor(expiresAt.getTime() / 1000),
    nonce: randomBytes(24).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", getSecret()).update(encoded).digest("base64url");
  return { token: `${encoded}.${sig}`, expiresAt };
}

function verifyToken(token: string): SessionPayload | null {
  try {
    const dot = token.lastIndexOf(".");
    if (dot < 1) return null;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = createHmac("sha256", getSecret()).update(payload).digest("base64url");
    const sigBuf = Buffer.from(sig, "base64url");
    const expBuf = Buffer.from(expected, "base64url");
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as SessionPayload;
    if (!data.userId || !data.nonce || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

async function deleteCookieSession(store: Awaited<ReturnType<typeof cookies>>): Promise<void> {
  const existing = store.get(SESSION_COOKIE)?.value;
  if (!existing) return;
  try {
    await prisma.session.deleteMany({ where: { token: hashToken(existing) } });
  } catch (e) {
    // SECURITY: If the DB delete fails, the Session row survives in the
    // database. The cookie is still cleared on the client (so the current
    // browser loses access), but a stolen copy of the cookie remains valid
    // for up to SESSION_TTL_DAYS (14 days) until the row expires.
    //
    // We cannot fail-closed here (returning 500 from logout would trap
    // users in a logged-in state), but we MUST log at error level so
    // operators can detect session-replay attempts. The previous code
    // silently swallowed the error with a bare `catch {}`, making this
    // gap invisible.
    //
    // Operator action: if you see this log, investigate the DB outage and
    // consider manually expiring the affected session rows.
    logger.error(
      `[auth] deleteCookieSession FAILED — session row survives in DB. ` +
      `A stolen copy of this cookie remains valid for up to SESSION_TTL_DAYS. ` +
      `Token hash (first 16 chars): ${hashToken(existing).slice(0, 16)}...`,
      { detail: e }
    );
  }
}

export async function createSession(userId: string) {
  await prismaReady;
  const store = await cookies();
  await deleteCookieSession(store);

  const { token, expiresAt } = makeToken(userId);
  await prisma.session.create({
    data: { token: hashToken(token), userId, expiresAt },
  });

  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL_ENV),
    path: "/",
    expires: expiresAt,
  });
}

export async function getSession(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const data = verifyToken(token);
  if (!data) return null;

  try {
    await prismaReady;
    const session = await prisma.session.findUnique({
      where: { token: hashToken(token) },
      select: { userId: true, expiresAt: true, user: { select: { deletedAt: true } } },
    });
    if (!session || session.userId !== data.userId || session.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    // Audit C-5: enforce soft-delete here, not only in getCurrentUser. Many API
    // routes authorize on getSession() alone and never load the user record, so
    // a check that lives only in getCurrentUser leaves that surface reachable by
    // a deactivated account. This is the same reasoning getCurrentUser already
    // documents for stolen cookies, applied at the choke point every caller
    // shares. The user row is fetched in the existing session query rather than
    // a second round trip, so no extra query is added per request.
    if (session.user?.deletedAt) return null;
    return session.userId;
  } catch (e) {
    // SECURITY / OBSERVABILITY: previously this catch was bare (`catch {}`),
    // silently returning `null` on DB errors. That made every DB outage look
    // like "user logged out" — operators had no signal to detect a session-DB
    // outage through this path. Compare with `deleteCookieSession` (lines 72-77)
    // which already logs at error level for the same class of failure.
    //
    // We still return null (fail-closed for auth — a DB we can't read cannot
    // confirm the session is valid), but now we surface the failure so
    // monitoring can catch it.
    logger.error(
      `[auth] getSession DB failure — treating as logged out. ` +
      `Token hash (first 16 chars): ${hashToken(token).slice(0, 16)}...`,
      { detail: e }
    );
    return null;
  }
}

export async function destroySession() {
  await prismaReady;
  const store = await cookies();
  await deleteCookieSession(store);
  store.delete(SESSION_COOKIE);
}

export async function destroyAllSessions(userId: string): Promise<void> {
  await prismaReady;
  await prisma.session.deleteMany({ where: { userId } });
}

export async function getCurrentUser() {
  const userId = await getSession();
  if (!userId) return null;
  await prismaReady;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  // Audit C-5: reject soft-deleted users. Even if a stolen cookie still
  // resolves to a session row (e.g. the soft-delete transaction committed
  // after the session was checked), the deletedAt field marks the user as
  // no longer authorized. This is the auth-layer enforcement of the
  // soft-delete pattern.
  if (user?.deletedAt) return null;
  return user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}

export const ROLES = ["ADMIN", "PROPOSAL_MANAGER", "REVIEWER", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export async function requireRole(...roles: Role[]) {
  const user = await requireUser();
  if (!roles.includes(user.role as Role)) {
    throw new Error("Forbidden");
  }
  return user;
}

export function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

export function forbiddenResponse() {
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Canonical role-authorization helper. Wraps requireRole in a try/catch and
 * returns the appropriate HTTP response (403 Forbidden for role mismatches,
 * 401 Unauthorized for missing/invalid sessions). Returns the authenticated
 * actor on success, or null if the caller should return the response.
 *
 * This eliminates the need for every route to repeat the same
 * `error.message === "Forbidden"` string matching pattern.
 */
export async function requireRoleOrRespond(
  ...roles: Role[]
): Promise<Awaited<ReturnType<typeof requireRole>> | Response> {
  try {
    return await requireRole(...roles);
  } catch (error) {
    // requireRole throws `new Error("Forbidden")` for role mismatches and
    // `new Error("Unauthorized")` for missing sessions. Any other error is
    // treated as unauthorized (fail-closed).
    if (error instanceof Error && error.message === "Forbidden") {
      return forbiddenResponse();
    }
    return unauthorizedResponse();
  }
}
