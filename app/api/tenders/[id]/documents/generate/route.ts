import { Packer, Paragraph, TextRun, HeadingLevel, Document } from "docx";
import { NextResponse } from "next/server";
import { getSession } from "../../../../../../lib/auth";
import { logAudit } from "../../../../../../lib/audit";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { saveGeneratedBuffer } from "../../../../../../lib/storage";

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
        generatedDocuments: { orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }] },
        complianceGaps: true,
      },
    });

    if (!tender) {
      return NextResponse.json({ error: "Tender not found" }, { status: 404 });
    }

    if (tender.generatedDocuments.length === 0) {
      return NextResponse.json({ error: "No planned documents. Run the tender engine first." }, { status: 400 });
    }

    const blockingGaps = tender.complianceGaps.filter(
      (gap) => !gap.isResolved && ["CRITICAL", "HIGH"].includes(gap.severity),
    );

    if (blockingGaps.length > 0) {
      return NextResponse.json({ error: "Resolve blocking compliance gaps before generation." }, { status: 400 });
    }

    const generated = [];

    for (const doc of tender.generatedDocuments) {
      const wordDoc = new Document({
        sections: [
          {
            children: [
              new Paragraph({ text: doc.exactFileName || doc.name, heading: HeadingLevel.TITLE }),
              new Paragraph({ children: [new TextRun({ text: `Tender: ${tender.title}`, bold: true })] }),
              new Paragraph({ text: `Document Type: ${doc.documentType}` }),
              new Paragraph({ text: `Reference: ${tender.reference || "N/A"}` }),
              new Paragraph({ text: "" }),
              new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Drafted Content Summary" }),
              new Paragraph({ text: doc.contentSummary || "No content summary available yet." }),
              new Paragraph({ text: "" }),
              new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Internal Generation Note" }),
              new Paragraph({ text: "This generated draft is based on the current tender engine plan and should be reviewed before external submission." }),
            ],
          },
        ],
      });

      const buffer = Buffer.from(await Packer.toBuffer(wordDoc));
      const stored = await saveGeneratedBuffer(doc.exactFileName || doc.name || `generated-${doc.id}`, "docx", buffer);

      const updated = await prisma.generatedDocument.update({
        where: { id: doc.id },
        data: {
          storagePath: stored.storagePath,
          generationStatus: "GENERATED",
          validationStatus: "PASSED",
          format: "DOCX",
        },
      });

      generated.push(updated);
    }

    await prisma.tender.update({
      where: { id: tender.id },
      data: {
        status: "GENERATED",
        stage: "GENERATION",
      },
    });

    await logAudit({
      userId,
      action: "tender_documents_generated",
      entityType: "Tender",
      entityId: tender.id,
      metadata: { generatedCount: generated.length },
    });

    return NextResponse.json({ success: true, generatedDocuments: generated });
  } catch (error) {
    console.error("Document generation failed:", error);
    return NextResponse.json({ error: "Document generation failed" }, { status: 500 });
  }
}
