import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { getCurrentUser } from "../../../../lib/auth";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const tender = await prisma.tender.findFirst({
    where: { id, userId: user.role === "ADMIN" ? undefined : user.id },
    include: { facts: { orderBy: { createdAt: "desc" } } }
  });
  if (!tender) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ facts: tender.facts });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN" && user.role !== "PROPOSAL_MANAGER") {
    return NextResponse.json({ error: "Forbidden: Read-only role" }, { status: 403 });
  }

  const { id } = await params;
  const tender = await prisma.tender.findFirst({
    where: { id, userId: user.role === "ADMIN" ? undefined : user.id }
  });
  if (!tender) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const fact = await prisma.tenderFact.upsert({
    where: { tenderId_semanticKey: { tenderId: id, semanticKey: body.semanticKey } },
    update: {
      displayLabel: body.displayLabel, category: body.category, valueType: body.valueType,
      normalizedValue: body.normalizedValue, rawSourceValue: body.rawSourceValue, structuredValue: body.structuredValue,
      authorityState: body.authorityState || "HUMAN_CONFIRMED_OPERATIONAL",
      isManual: true, manualReason: body.manualReason, manualBasis: body.manualBasis, updatedById: user.id
    },
    create: {
      tenderId: id, semanticKey: body.semanticKey, displayLabel: body.displayLabel, category: body.category, valueType: body.valueType,
      normalizedValue: body.normalizedValue, rawSourceValue: body.rawSourceValue, structuredValue: body.structuredValue,
      authorityState: body.authorityState || "HUMAN_CONFIRMED_OPERATIONAL",
      isManual: true, manualReason: body.manualReason, manualBasis: body.manualBasis, createdById: user.id, updatedById: user.id
    }
  });

  return NextResponse.json({ fact });
}
