import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { createSession } from "@/lib/auth";

const prisma = new PrismaClient();

export async function POST(req: Request) {
  const { email, password } = await req.json();

  // 🔥 use EMAIL (not name)
  const user = await prisma.user.findUnique({
    where: { email },
  });

  // if no user → create one (first login)
  if (!user) {
    const newUser = await prisma.user.create({
      data: {
        email,
        password,
      },
    });

    await createSession(newUser.id);
    return NextResponse.json({ success: true });
  }

  // check password
  if (user.password !== password) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  await createSession(user.id);

  return NextResponse.json({ success: true });
}
