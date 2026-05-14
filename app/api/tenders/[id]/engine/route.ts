import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { runTenderEngine } from "../../../../../lib/engine/run-tender-engine";
import { assessExtractionQuality } from "../../../../../lib/extraction-quality";

// Vercel route timeout — engine runs analyze + extract + match. Default
// 10s is too short. 60 = Hobby max; Pro uses its own plan limit.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prismaReady;

  try {
    const { id } = await params;
    const force = new URL(req.url).searchParams.get("force") === "true";
    const tender = await prisma.tender.findFirst({
      where: { id, userId },
      include: { files: { select: { id: true, originalFileName: true, fileName: true, extractedText: true } } },
    });
    if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

    const extractionReports = tender.files.map((file) => ({
      fileName: file.originalFileName || file.fileName,
      quality: assessExtractionQuality(file.extractedText, file.originalFileName || file.fileName),
    }));
    const blockers = extractionReports.filter((item) => item.quality.severity === "FAILED" || item.quality.severity === "POOR");
    if (!force && blockers.length > 0) {
      return NextResponse.json({
        error: "Engine run blocked: one or more tender files have poor extraction quality.",
        code: "EXTRACTION_NOT_READY",
        nextAction: "OPEN_EXTRACTION_QUALITY",
        blockers,
        hint: "Re-import/OCR/review the file, or retry with ?force=true only when you intentionally accept degraded analysis quality.",
      }, { status: 422 });
    }

    const result = await runTenderEngine(id, userId);
    return NextResponse.json({ success: true, tender: result, extractionWarnings: extractionReports.filter((item) => item.quality.severity === "WARNING") });
  } catch (error) {
    console.error("Engine run failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Engine failed" }, { status: 500 });
  }
}
