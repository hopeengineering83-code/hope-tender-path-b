import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { createSession } from "../../../../lib/auth";

export async function POST(req: Request) {
  const { email, password } = await req.json();

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user || user.password !== password) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  await createSession(user.id);

  return NextResponse.json({ success: true });
}
