import JSZip from "jszip";
import { ExportFormat } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { logAudit } from "../../../../../lib/audit";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { readStoredFile, saveGeneratedBuffer } from "../../../../../lib/storage";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prismaReady;

  try {
    const { id } = await params;
    const tender = await prisma.tender.findFirst({
      where: { id, userId },
      include: {
        complianceGaps: true,
        generatedDocuments: { orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }] },
      },
    });

    if (!tender) {
      return NextResponse.json({ error: "Tender not found" }, { status: 404 });
    }

    const blockingGaps = tender.complianceGaps.filter(
      (gap) => !gap.isResolved && ["CRITICAL", "HIGH"].includes(gap.severity),
    );

    if (blockingGaps.length > 0) {
      return NextResponse.json(
        { error: "Resolve high-severity compliance gaps before export preparation." },
        { status: 400 },
      );
    }

    if (tender.generatedDocuments.length === 0) {
      return NextResponse.json({ error: "Run the tender engine before export preparation." }, { status: 400 });
    }

    const missingFiles = tender.generatedDocuments.filter((doc) => !doc.storagePath);
    if (missingFiles.length > 0) {
      return NextResponse.json({ error: "Generate document files before preparing export." }, { status: 400 });
    }

    const zip = new JSZip();
    for (const doc of tender.generatedDocuments) {
      const buffer = await readStoredFile(doc.storagePath as string);
      const fileName = doc.exactFileName || doc.name;
      zip.file(fileName.endsWith(".docx") ? fileName : `${fileName}.docx`, buffer);
    }

    const zipBuffer = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
    const stored = await saveGeneratedBuffer(`${tender.title} Submission Package`, "zip", zipBuffer);

    const exportPackage = await prisma.exportPackage.create({
      data: {
        tenderId: tender.id,
        name: `${tender.title} Submission Package`,
        format: ExportFormat.ZIP,
        exportStatus: "ready",
        createdById: userId,
        storagePath: stored.storagePath,
      },
    });

    await prisma.tender.update({
      where: { id: tender.id },
      data: {
        status: "EXPORTED",
        stage: "EXPORT",
      },
    });

    await logAudit({
      userId,
      action: "tender_export_prepared",
      entityType: "ExportPackage",
      entityId: exportPackage.id,
      metadata: { tenderId: tender.id, documentCount: tender.generatedDocuments.length },
    });

    return NextResponse.json({ success: true, exportPackage }, { status: 201 });
  } catch (error) {
    console.error("Export preparation failed:", error);
    return NextResponse.json({ error: "Export preparation failed" }, { status: 500 });
  }
}
