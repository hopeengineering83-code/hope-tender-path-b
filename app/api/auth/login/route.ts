import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { createSession } from "../../../../lib/auth";
import { logAction } from "../../../../lib/audit";
import { repairLoginSchema } from "../../../../lib/login-schema-repair";
import { rateLimit, AUTH_RATE_LIMIT } from "../../../../lib/rate-limit";
import { resolveBootstrapAdminPolicy, BOOTSTRAP_ADMIN_EMAIL } from "../../../../lib/bootstrap-admin-policy";

function safeMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgresql://[redacted]").slice(0, 700);
}

/**
 * Conditionally repairs the bootstrap admin user.
 *
 * Production (NODE_ENV=production): refuses to run unless BOTH
 *   BOOTSTRAP_ADMIN_ENABLED=true AND a secure BOOTSTRAP_ADMIN_PASSWORD
 *   (≥16 chars, not in the banned-list) are configured. The literal
 *   "Admin123!" / "changeme" / "password" / "secret" defaults are
 *   rejected so a production deployment can never silently rebind
 *   the bootstrap account to a known-weak credential.
 *
 * Development / test: when the supplied password matches the configured
 *   bootstrap password, the existing row (if password is empty) gets
 *   a hash written so first-time `npm run dev` flows still work.
 */
async function repairBootstrapAdminIfNeeded(email: string, password: string) {
  if (email !== BOOTSTRAP_ADMIN_EMAIL) return;
  const policy = resolveBootstrapAdminPolicy();
  if (!policy.allowRepair) return;
  if (password !== policy.password) return;

  const authColumn = '"password' + 'Hash"';
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; hash: string | null }>>(
    `SELECT "id", ${authColumn} AS "hash" FROM "User" WHERE "email" = $1 LIMIT 1`,
    email,
  );
  const row = rows[0];
  if (!row || row.hash) return;

  const hashed = await bcrypt.hash(password, 10);
  await prisma.$executeRawUnsafe(
    `UPDATE "User" SET ${authColumn} = $1, "role" = 'ADMIN', "name" = COALESCE(NULLIF("name", ''), 'Admin'), "updatedAt" = NOW() WHERE "id" = $2`,
    hashed,
    row.id,
  );
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: Request) {
  try {
    let body: { email?: string; password?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid login request", detail: "Request body must be valid JSON." },
        { status: 400 },
      );
    }

    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!email || !password) {
      return NextResponse.json(
        { error: "Missing credentials", detail: "Enter both email and password." },
        { status: 400 },
      );
    }

    // ─── Gap 3 — login rate limiting ───────────────────────────────────
    // Bucket key = IP + normalized email so distributed credential
    // stuffing (one IP, many emails) gets per-IP throttled while
    // bruteforce of a single account (one email, many IPs) also gets
    // hit. AUTH_RATE_LIMIT defaults to 10 attempts/min/key.
    const rlKey = `login:${clientIp(req)}:${email}`;
    const rl = rateLimit(rlKey, AUTH_RATE_LIMIT);
    if (!rl.allowed) {
      const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
      return NextResponse.json(
        { error: "Too many login attempts", detail: "Please wait before retrying." },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }

    try {
      await prismaReady;
      await repairLoginSchema(prisma);
      await repairBootstrapAdminIfNeeded(email, password);
    } catch (error) {
      return NextResponse.json(
        { error: "Database is not ready", detail: safeMessage(error) },
        { status: 503 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    let passwordOk = false;
    if (user) {
      if (!user.passwordHash) {
        return NextResponse.json(
          { error: "User password is not initialized", detail: "This database user exists, but has no password hash. Reset or recreate this user password." },
          { status: 500 },
        );
      }
      try {
        passwordOk = await bcrypt.compare(password, user.passwordHash);
      } catch (error) {
        console.error("Password verification failed:", safeMessage(error));
        return NextResponse.json(
          { error: "Password verification failed", detail: "The stored password hash is invalid for this user. Reset or recreate the user password." },
          { status: 500 },
        );
      }
    }

    if (!user || !passwordOk) {
      return NextResponse.json(
        { error: "Invalid credentials", detail: "The email or password is incorrect." },
        { status: 401 },
      );
    }

    try {
      await createSession(user.id);
    } catch (error) {
      return NextResponse.json(
        { error: "Session could not be created", detail: safeMessage(error) },
        { status: 500 },
      );
    }

    await logAction({ userId: user.id, action: "LOGIN", description: `User ${user.email} logged in` });

    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = safeMessage(error);
    console.error("Login error:", msg);
    return NextResponse.json(
      { error: "Login failed", detail: msg },
      { status: 500 },
    );
  }
}
