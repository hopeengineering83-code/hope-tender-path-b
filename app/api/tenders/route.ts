import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../lib/prisma";
import { getSession } from "../../../lib/auth";

export async function GET() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;
  const tenders = await prisma.tender.findMany({
    where: { userId },
    include: { documents: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(tenders);
}

export async function POST(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;
  try {
    const body = await req.json();
    const tender = await prisma.tender.create({
      data: {
        id: crypto.randomUUID(),
        title: body.title,
        description: body.description || null,
        reference: body.reference || null,
        category: body.category || "General",
        budget: body.budget ? parseFloat(body.budget) : null,
        currency: body.currency || "USD",
        deadline: body.deadline || null,
        requirements: body.requirements || null,
        notes: body.notes || null,
        status: "draft",
        userId,
      },
    });
    return NextResponse.json(tender, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to create tender" }, { status: 500 });
  }
}
