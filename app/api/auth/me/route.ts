import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";

export async function GET() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } });

  await prismaReady;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store, max-age=0" } });
  return NextResponse.json(user, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
