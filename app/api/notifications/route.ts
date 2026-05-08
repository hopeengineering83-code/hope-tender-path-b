import { NextResponse } from "next/server";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get("unread") === "true";
  const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 100);

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  return NextResponse.json({ notifications, unreadCount });
}

export async function PATCH(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const ids: string[] = Array.isArray(body.ids) ? (body.ids as string[]) : [];
  const markAll = body.markAll === true;

  if (markAll) {
    const result = await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return NextResponse.json({ updated: result.count });
  }

  if (ids.length === 0) return NextResponse.json({ error: "ids or markAll required" }, { status: 400 });

  const result = await prisma.notification.updateMany({
    where: { userId, id: { in: ids }, readAt: null },
    data: { readAt: new Date() },
  });

  return NextResponse.json({ updated: result.count });
}
