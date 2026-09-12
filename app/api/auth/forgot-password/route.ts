import { logger } from "../../../../lib/observability";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { generateResetToken } from "../../../../lib/reset-token";
import { rateLimitPersistent, PASSWORD_RESET_RATE_LIMIT } from "../../../../lib/rate-limit";
import { getClientIp } from "../../../../lib/request-ip";
import { sendEmail } from "../../../../lib/email";
import { logAction } from "../../../../lib/audit";

const GENERIC_RESPONSE = {
  success: true,
  note: "If that email is registered and email delivery is configured, password reset instructions will be sent.",
};

function baseUrl(): string {
  const configured = process.env.APP_URL ?? process.env.NEXTAUTH_URL;
  if (configured) return configured.replace(/\/$/, "");
  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  // SECURITY / OPS: previously this returned "http://localhost:3000" unconditionally.
  // In self-hosted production (Docker, bare-metal, Electron desktop) where the
  // Vercel env vars are absent, password-reset emails would contain a
  // `localhost:3000` link — broken for end users AND a security smell (reset
  // link points at an attacker-controllable local host on shared machines).
  // Fail-loud in production; keep the dev convenience fallback for `next dev`.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "APP_URL (or NEXTAUTH_URL) must be set in production so password-reset emails link to the real site. " +
      "Refusing to send a reset email with a localhost URL."
    );
  }
  return "http://localhost:3000";
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { email?: string };
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || email.length > 320 || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });
  }

  try {
    const ip = getClientIp(req);
    const [ipLimit, accountLimit] = await Promise.all([
      rateLimitPersistent(`forgot-password:ip:${ip}`, PASSWORD_RESET_RATE_LIMIT),
      rateLimitPersistent(`forgot-password:account:${email}`, PASSWORD_RESET_RATE_LIMIT),
    ]);
    if (!ipLimit.allowed || !accountLimit.allowed) {
      const resetAt = Math.max(ipLimit.resetAt, accountLimit.resetAt);
      const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
      return NextResponse.json(GENERIC_RESPONSE, {
        status: 202,
        headers: { "Retry-After": String(retryAfter) },
      });
    }

    await prismaReady;
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });
    if (!user) {
      // TIMING-SAFE ACCOUNT ENUMERATION GUARD: For existing users, the code
      // below does a DB transaction + sendEmail(), which takes ~300-800ms.
      // For non-existent users, returning immediately (~5ms) allows an
      // attacker to distinguish existing vs non-existing emails by timing.
      // Run a dummy bcrypt comparison to narrow the timing gap.
      try {
        await bcrypt.compare(
          "dummy-password-for-timing-equalization",
          "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy",
        );
      } catch { /* rate limit is the primary defense */ }
      return NextResponse.json(GENERIC_RESPONSE, { status: 202 });
    }

    const { token, tokenHash, expiresAt } = generateResetToken();
    const tokenId = randomUUID();

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        DELETE FROM "PasswordResetToken"
        WHERE "userId" = ${user.id} AND "consumedAt" IS NULL
      `;
      await tx.$executeRaw`
        INSERT INTO "PasswordResetToken"
          ("id", "userId", "tokenHash", "expiresAt", "createdAt")
        VALUES (${tokenId}, ${user.id}, ${tokenHash}, ${expiresAt}, NOW())
      `;
    });

    const resetUrl = `${baseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
    const delivery = await sendEmail({
      to: user.email,
      subject: "Reset your Hope Tender password",
      html: `<p>A password reset was requested for your account.</p><p><a href="${resetUrl}">Reset password</a></p><p>This link expires in 20 minutes and can be used once.</p><p>If you did not request this, ignore this email.</p>`,
    });

    if (!delivery.delivered) {
      await prisma.$executeRaw`
        DELETE FROM "PasswordResetToken"
        WHERE "id" = ${tokenId}
      `;
    }

    await logAction({
      userId: user.id,
      action: "UPDATE",
      entityType: "UserSecurity",
      entityId: user.id,
      description: delivery.delivered
        ? "Password reset instructions requested and delivered"
        : "Password reset instructions requested but delivery was unavailable",
      metadata: { delivered: delivery.delivered, reason: delivery.reason ?? null },
    });

    return NextResponse.json(GENERIC_RESPONSE, { status: 202 });
  } catch (error) {
    logger.error("[forgot-password] request failed", {
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "Password reset is temporarily unavailable" },
      { status: 503 },
    );
  }
}
