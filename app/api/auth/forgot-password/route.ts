import { NextResponse } from "next/server";
import { createHmac } from "crypto";
import { prisma, prismaReady } from "../../../../lib/prisma";

function getSecret(): string {
  return process.env.SESSION_SECRET ?? "dev-secret-change-me";
}

export function makeResetToken(userId: string): string {
  const exp = Math.floor(Date.now() / 1000) + 3600; // 1-hour TTL
  const payload = Buffer.from(JSON.stringify({ userId, exp, purpose: "reset" })).toString("base64url");
  const sig = createHmac("sha256", getSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export async function POST(req: Request) {
  await prismaReady;

  const { email } = await req.json().catch(() => ({})) as { email?: string };
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true },
  });

  // Always respond the same way regardless of whether user exists (prevent enumeration)
  if (!user) {
    return NextResponse.json({ success: true, note: "If that email is registered, a reset link was generated." });
  }

  const token = makeResetToken(user.id);
  const baseUrl = process.env.NEXTAUTH_URL ?? process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";
  const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}&uid=${encodeURIComponent(user.id)}`;

  // No email service configured — return reset link directly so admin can share it.
  return NextResponse.json({
    success: true,
    note: "Email delivery is not configured. Copy the link below and share it with the user.",
    resetLink: resetUrl,
    expiresInMinutes: 60,
  });
}
