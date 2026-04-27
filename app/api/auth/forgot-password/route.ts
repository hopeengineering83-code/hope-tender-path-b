import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { makeResetToken } from "../../../../lib/reset-token";

export async function POST(req: Request) {
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
