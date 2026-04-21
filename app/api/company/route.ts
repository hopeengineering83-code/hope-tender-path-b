import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../lib/prisma";
import { getSession } from "../../../lib/auth";

export async function GET() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;
  const company = await prisma.company.findUnique({ where: { userId } });
  return NextResponse.json(company);
}

export async function PUT(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;
  try {
    const body = await req.json();
    const company = await prisma.company.upsert({
      where: { userId },
      create: {
        id: crypto.randomUUID(),
        name: body.name || "My Company",
        description: body.description || null,
        website: body.website || null,
        address: body.address || null,
        phone: body.phone || null,
        email: body.email || null,
        userId,
      },
      update: {
        name: body.name,
        description: body.description || null,
        website: body.website || null,
        address: body.address || null,
        phone: body.phone || null,
        email: body.email || null,
      },
    });
    return NextResponse.json(company);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to save company" }, { status: 500 });
  }
}
