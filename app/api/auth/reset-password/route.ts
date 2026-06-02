import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { verifyResetToken } from "../../../../lib/reset-token";
import { rateLimit, AUTH_RATE_LIMIT } from "../../../../lib/rate-limit";
import { validatePassword } from "../../../../lib/password-policy";

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: Request) {
  const rl = rateLimit(`reset-password:${clientIp(req)}`, AUTH_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json({ error: "Too many requests", detail: "Please wait before retrying." }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  await prismaReady;

  const { token, uid, password } = await req.json().catch(() => ({})) as {
    token?: string; uid?: string; password?: string;
  };

  if (!token || !uid || !password) {
    return NextResponse.json({ error: "token, uid, and password are required" }, { status: 400 });
  }
  const pwCheck = validatePassword(password);
  if (!pwCheck.ok) return NextResponse.json({ error: pwCheck.error }, { status: 400 });

  const verified = verifyResetToken(token);
  if (!verified || verified.userId !== uid) {
    return NextResponse.json({ error: "Invalid or expired reset link" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({ where: { id: uid }, data: { passwordHash } });

  return NextResponse.json({ success: true });
}
