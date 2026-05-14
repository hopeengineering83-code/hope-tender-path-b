import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { assessExtractionQuality } from "../../../../../lib/extraction-quality";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;
  const tender = await prisma.tender.findFirst({
    where: { id, userId },
    include: { files: { orderBy: { createdAt: "asc" } } },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const files = tender.files.map((file) => ({
    id: file.id,
    fileName: file.originalFileName || file.fileName,
    mimeType: file.mimeType,
    quality: assessExtractionQuality(file.extractedText, file.originalFileName || file.fileName),
  }));

  const blockers = files.filter((file) => file.quality.severity === "FAILED" || file.quality.severity === "POOR");
  const warnings = files.filter((file) => file.quality.severity === "WARNING");

  return NextResponse.json({
    tenderId: id,
    readyForAnalysis: blockers.length === 0,
    blockers: blockers.map((file) => ({ fileName: file.fileName, quality: file.quality })),
    warnings: warnings.map((file) => ({ fileName: file.fileName, quality: file.quality })),
    files,
  });
}
