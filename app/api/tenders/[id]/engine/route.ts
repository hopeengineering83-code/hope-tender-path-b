import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { runTenderEngine } from "../../../../../lib/engine/run-tender-engine";
import { assessExtractionQuality } from "../../../../../lib/extraction-quality";
import { actionableEngineError } from "../../../../../lib/engine/actionable-engine-error";

// Vercel route timeout — engine runs analyze + extract + match. Default
// 10s is too short. 60 = Hobby max; Pro uses its own plan limit.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function requestDiagnosticId() {
  return `eng_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const diagnosticId = requestDiagnosticId();
  const userId = await getSession();
  if (!userId) {
    return NextResponse.json({
      error: "Unauthorized. Sign in again before running the tender engine.",
      code: "UNAUTHORIZED",
      nextAction: "LOGIN_AGAIN",
      diagnosticId,
    }, { status: 401 });
  }

  try {
    await prismaReady;

    const { id } = await params;
    const force = new URL(req.url).searchParams.get("force") === "true";
    const tender = await prisma.tender.findFirst({
      where: { id, userId },
      include: { files: { select: { id: true, originalFileName: true, fileName: true, extractedText: true } } },
    });
    if (!tender) return NextResponse.json({ error: "Tender not found", code: "TENDER_NOT_FOUND", diagnosticId }, { status: 404 });

    if (tender.files.length === 0) {
      return NextResponse.json({
        error: "Engine run blocked: no tender file is uploaded.",
        code: "NO_TENDER_FILES",
        nextAction: "UPLOAD_TENDER_DOCUMENT",
        hint: "Upload the tender/RFP document first, then run AI Analyze or Run Engine.",
        diagnosticId,
      }, { status: 422 });
    }

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
        diagnosticId,
      }, { status: 422 });
    }

    const result = await runTenderEngine(id, userId);
    return NextResponse.json({
      success: true,
      tender: result,
      extractionWarnings: extractionReports.filter((item) => item.quality.severity === "WARNING"),
      diagnosticId,
    });
  } catch (error) {
    console.error("Engine run failed:", { diagnosticId, error });
    const mapped = actionableEngineError(error);
    return NextResponse.json({ ...mapped.body, diagnosticId }, { status: mapped.status });
  }
}
