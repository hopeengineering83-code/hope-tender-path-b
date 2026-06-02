import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { makeResetToken } from "../../../../lib/reset-token";
import { rateLimit, AUTH_RATE_LIMIT } from "../../../../lib/rate-limit";

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: Request) {
  const rl = rateLimit(`forgot-password:${clientIp(req)}`, AUTH_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json({ error: "Too many requests", detail: "Please wait before retrying." }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  await prismaReady;

  const { email } = await req.json().catch(() => ({})) as { email?: string };
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true },
  });

  if (!user) {
    return NextResponse.json({ success: true, note: "If that email is registered, a reset link was generated." });
  }

  const token = makeResetToken(user.id);
  const vercelUrl = process.env.VERCEL_URL;
  const baseUrl = process.env.NEXTAUTH_URL ?? (vercelUrl ? `https://${vercelUrl}` : "http://localhost:3000");
  const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}&uid=${encodeURIComponent(user.id)}`;

  return NextResponse.json({
    success: true,
    note: "Email delivery is not configured. Copy the link below and share it with the user.",
    resetLink: resetUrl,
    expiresInMinutes: 60,
  });
}
