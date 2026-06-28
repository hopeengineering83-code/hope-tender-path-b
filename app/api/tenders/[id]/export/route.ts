import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { assertTenderReadyForGenerationAndExport } from "../../../../../lib/engine/generation-readiness-gate";
import { logAction } from "../../../../../lib/audit";
import { sanitizeError } from "../../../../../lib/sanitize-error";
import { logger } from "../../../../../lib/observability";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getSession();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await prismaReady;

    const { id } = await params;

    // Rule 4: Strengthening the existing central gate usage.
    // This is the authoritative check before export.
    const gate = await assertTenderReadyForGenerationAndExport({
      prisma,
      tenderId: id,
      userId,
      purpose: "export"
    });

    if (!gate.ok) {
      return NextResponse.json({
        ok: false,
        errorCode: gate.blockerCode,
        error: `Export blocked: ${gate.blockerDetail}`,
      }, { status: 422 });
    }

    const tender = await prisma.tender.findUnique({
      where: { id, userId },
      include: {
        generatedDocuments: { where: { generationStatus: "GENERATED" } },
      }
    });

    if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

    const generatedFileNames = tender.generatedDocuments
      .sort((a, b) => (a.exactOrder ?? 999) - (b.exactOrder ?? 999))
      .map((doc) => doc.exactFileName ?? doc.name);

    if (generatedFileNames.length === 0) {
      return NextResponse.json({ error: "No generated documents available for export." }, { status: 400 });
    }

    const exportPackage = await prisma.exportPackage.create({
      data: {
        tenderId: id,
        status: "READY",
        fileList: JSON.stringify(generatedFileNames),
      }
    });

    await prisma.tender.update({
      where: { id },
      data: { status: "EXPORTED", stage: "EXPORT" },
    });

    await logAction({
      userId,
      action: "EXPORT_PACKAGE_CREATE",
      entityType: "Tender",
      entityId: id,
      description: `Prepared export package for "${tender.title}"`,
    });

    return NextResponse.json({ ok: true, exportPackage });
  } catch (err) {
    logger.error("Export preparation failed", { error: err });
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}
