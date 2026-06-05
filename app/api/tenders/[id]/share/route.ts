import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;
  const { id: tenderId } = await params;
  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const share = await prisma.tenderShare.create({
    data: { tenderId, createdById: userId, label: body.label ?? null, expiresAt: body.expiresAt ? new Date(body.expiresAt) : null },
  });
  return NextResponse.json({ token: share.token, shareUrl: `/share/${share.token}` });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;
  const { id: tenderId } = await params;
  const shares = await prisma.tenderShare.findMany({
    where: { tenderId, tender: { userId } },
    orderBy: { createdAt: "desc" },
    select: { id: true, token: true, label: true, createdAt: true, expiresAt: true },
  });
  return NextResponse.json({ shares });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;
  const { id: tenderId } = await params;
  const body = await req.json().catch(() => ({}));
  if (!body.shareId) return NextResponse.json({ error: "shareId required" }, { status: 400 });
  await prisma.tenderShare.deleteMany({ where: { id: body.shareId, tenderId, tender: { userId } } });
  return NextResponse.json({ ok: true });
}
