import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";
import { prisma, prismaReady } from "../../../../lib/prisma";

function getSecret(): string {
  return process.env.SESSION_SECRET ?? "dev-secret-change-me";
}

function verifyResetToken(token: string): { userId: string } | null {
  try {
    const dot = token.lastIndexOf(".");
    if (dot < 1) return null;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = createHmac("sha256", getSecret()).update(payload).digest("base64url");
    const sigBuf = Buffer.from(sig, "base64url");
    const expBuf = Buffer.from(expected, "base64url");
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      userId: string; exp: number; purpose: string;
    };
    if (data.purpose !== "reset") return null;
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return { userId: data.userId };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  await prismaReady;

  const { token, uid, password } = await req.json().catch(() => ({})) as {
    token?: string; uid?: string; password?: string;
  };

  if (!token || !uid || !password) {
    return NextResponse.json({ error: "token, uid, and password are required" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const verified = verifyResetToken(token);
  if (!verified || verified.userId !== uid) {
    return NextResponse.json({ error: "Invalid or expired reset link" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({ where: { id: uid }, data: { passwordHash } });

  return NextResponse.json({ success: true });
}
