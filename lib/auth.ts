import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { prisma, prismaReady } from "./prisma";

const SESSION_COOKIE = "hope_session";
const SESSION_TTL_DAYS = 14;

// Fallback secret is consistent across all Lambda containers (same deployed code).
// Set SESSION_SECRET in Vercel env vars for production security.
function getSecret(): string {
  return process.env.SESSION_SECRET ?? "hope-tender-path-built-in-secret-v1";
}

function makeToken(userId: string): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_DAYS * 86400;
  const payload = Buffer.from(JSON.stringify({ userId, exp })).toString("base64url");
  const sig = createHmac("sha256", getSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyToken(token: string): { userId: string; exp: number } | null {
  try {
    const dot = token.lastIndexOf(".");
    if (dot < 1) return null;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = createHmac("sha256", getSecret()).update(payload).digest("base64url");
    const sigBuf = Buffer.from(sig, "base64url");
    const expBuf = Buffer.from(expected, "base64url");
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { userId: string; exp: number };
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

export async function createSession(userId: string) {
  const token = makeToken(userId);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400 * 1000);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function getSession(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const data = verifyToken(token);
  if (!data) {
    store.delete(SESSION_COOKIE);
    return null;
  }
  return data.userId;
}

export async function destroySession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getCurrentUser() {
  const userId = await getSession();
  if (!userId) return null;
  await prismaReady;
  return prisma.user.findUnique({ where: { id: userId } });
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}
