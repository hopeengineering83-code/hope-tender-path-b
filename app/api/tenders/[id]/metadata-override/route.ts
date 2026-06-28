import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { resolveCanonicalFieldState } from "../../../../../lib/engine/canonical-field-state";
import { sanitizeError } from "../../../../../lib/sanitize-error";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getSession();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await prismaReady;

    const { id } = await params;
    const { field, fieldState, overrideValue, reason } = await req.json();

    const tender = await prisma.tender.findUnique({
      where: { id, userId },
      include: {
        metadataOverrides: true,
        requirements: true,
      }
    });

    if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

    await prisma.tenderMetadataOverride.upsert({
      where: { tenderId_field: { tenderId: id, field } },
      create: {
        tenderId: id,
        field,
        fieldState,
        overrideValue,
        reason,
        overriddenBy: userId,
      },
      update: {
        fieldState,
        overrideValue,
        reason,
        overriddenBy: userId,
      }
    });

    const updatedTender = await prisma.tender.findUnique({
      where: { id, userId },
      include: {
        metadataOverrides: true,
        requirements: true,
      }
    });

    const resolved = resolveCanonicalFieldState({
      tender: updatedTender as any,
      overrides: updatedTender!.metadataOverrides as any,
      hasExtractedRequirements: updatedTender!.requirements.length > 0,
    });

    return NextResponse.json({ ok: true, resolved });
  } catch (err) {
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}
