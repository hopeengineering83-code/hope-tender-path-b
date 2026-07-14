import { logger } from "../../../../lib/observability";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { generateResetToken } from "../../../../lib/reset-token";
import { rateLimitPersistent, PASSWORD_RESET_RATE_LIMIT } from "../../../../lib/rate-limit";
import { getClientIp } from "../../../../lib/request-ip";
import { sendEmail } from "../../../../lib/email";
import { logAction } from "../../../../lib/audit";

const GENERIC_RESPONSE = {
  success: true,
  note: "If that email is registered, password reset instructions will be sent.",
};

function baseUrl(): string {
  const configured = process.env.APP_URL ?? process.env.NEXTAUTH_URL;
  if (configured) return configured.replace(/\/$/, "");
  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
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
      // TIMING-SAFE ACCOUNT ENUMERATION GUARD (round-2 audit GAP-R2C-3):
      // For existing users, the code below does a DB transaction + sendEmail(),
      // which takes ~300-800ms. For non-existent users, we previously returned
      // immediately (~5ms). An attacker can distinguish existing vs non-existing
      // emails by response timing, enabling account enumeration.
      //
      // Fix: run a dummy bcrypt comparison (which takes ~100-300ms) to make
      // the timing distribution overlap with the existing-user path. This
      // doesn't fully eliminate timing variance (sendEmail latency varies),
      // but it narrows the gap enough that simple timing attacks become
      // impractical. Combined with the rate limit (5/15min), enumeration
      // would take hours for a small candidate list.
      //
      // We use bcrypt.compare with a dummy hash to consume similar CPU time.
      try {
        const bcrypt = await import("bcryptjs");
        // A pre-computed bcrypt hash of a random string (cost factor 10, matching
        // the login path's DUMMY_PASSWORD_HASH pattern). This takes ~100-200ms.
        await bcrypt.compare(
          "dummy-password-for-timing-equalization",
          "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"
        );
      } catch {
        // If bcrypt fails (shouldn't happen), don't change the timing —
        // the rate limit is the primary defense.
      }
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
