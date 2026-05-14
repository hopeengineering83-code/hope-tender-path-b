import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { runTenderEngine } from "../../../../../lib/engine/run-tender-engine";
import { assessExtractionQuality } from "../../../../../lib/extraction-quality";

// Vercel route timeout — engine runs analyze + extract + match. Default
// 10s is too short. 60 = Hobby max; Pro uses its own plan limit.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function actionableEngineError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Engine failed");
  const lower = message.toLowerCase();

  if (/timeout|timed out|abort/i.test(message)) {
    return {
      status: 504,
      body: {
        error: "Engine run timed out before completion.",
        code: "ENGINE_TIMEOUT",
        detail: message,
        nextAction: "RETRY_OR_REDUCE_INPUT",
        hint: "Retry after confirming extraction quality. For very large tenders, reduce duplicate uploads or run AI Analyze first, then Run Engine.",
      },
    };
  }

  if (/database|prisma|connection|prepared statement|transaction/i.test(message)) {
    return {
      status: 503,
      body: {
        error: "Engine run failed because the database layer was unavailable or rejected the operation.",
        code: "ENGINE_DATABASE_ERROR",
        detail: message,
        nextAction: "RETRY_AFTER_DATABASE_CHECK",
        hint: "Check DATABASE_URL/Vercel database availability, then retry. If this repeats, open the latest server log for the failed request.",
      },
    };
  }

  if (lower.includes("no tender") || lower.includes("tender not found")) {
    return {
      status: 404,
      body: {
        error: "Tender could not be loaded for engine execution.",
        code: "TENDER_NOT_FOUND",
        detail: message,
        nextAction: "OPEN_TENDER_LIST",
      },
    };
  }

  return {
    status: 500,
    body: {
      error: "Engine run failed before completion.",
      code: "ENGINE_FAILED",
      detail: message,
      nextAction: "OPEN_EXTRACTION_ANALYSIS_MATCHING_QUALITY",
      hint: "Review Extraction Quality, Analysis Quality, and Matching Quality panels. The original server error is included in detail.",
    },
  };
}

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
    if (!tender) return NextResponse.json({ error: "Tender not found", code: "TENDER_NOT_FOUND" }, { status: 404 });

    if (tender.files.length === 0) {
      return NextResponse.json({
        error: "Engine run blocked: no tender file is uploaded.",
        code: "NO_TENDER_FILES",
        nextAction: "UPLOAD_TENDER_DOCUMENT",
        hint: "Upload the tender/RFP document first, then run AI Analyze or Run Engine.",
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
      }, { status: 422 });
    }

    const result = await runTenderEngine(id, userId);
    return NextResponse.json({ success: true, tender: result, extractionWarnings: extractionReports.filter((item) => item.quality.severity === "WARNING") });
  } catch (error) {
    console.error("Engine run failed:", error);
    const mapped = actionableEngineError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
