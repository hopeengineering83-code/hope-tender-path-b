import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { verifyResetToken } from "../../../../lib/reset-token";

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
