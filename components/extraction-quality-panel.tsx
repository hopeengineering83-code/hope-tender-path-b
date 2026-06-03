import Link from "next/link";
import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { assessExtractionQuality } from "../lib/extraction-quality";
import { isExtractionCorrupted } from "../lib/engine/extraction-quality-gate";

const EXTRACTION_STATUS_LABELS: Record<string, string> = {
  FULL_EXTRACTION_AI_ANALYZED: "Full extraction",
  PARTIAL_EXTRACTION_AI_ANALYZED: "Partial extraction",
  OCR_REQUIRED: "OCR required",
  EXTRACTION_WEAK_REVIEW_REQUIRED: "Weak — review required",
  REGEX_FALLBACK_FROM_WEAK_EXTRACTION: "Very poor — regex fallback",
  EXTRACTION_CORRUPTED_AI_SKIPPED: "Corrupted — AI blocked",
};

export async function ExtractionQualityPanel({ tenderId }: { tenderId: string }) {
  const userId = await getSession();
  if (!userId) return null;

  await prismaReady;
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    select: {
      analysisExtractionStatus: true,
      metadataContaminated: true,
      files: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true, fileName: true, originalFileName: true, extractedText: true,
          totalPages: true, extractedPages: true, ocrPages: true, failedPages: true,
          extractionScore: true, extractionMethod: true,
        },
      },
    },
  });
  if (!tender || tender.files.length === 0) return null;

  const reports = tender.files.map((file) => {
    const extractedText = file.extractedText ?? "";
    const isCorrupted = extractedText.length > 20 && isExtractionCorrupted(extractedText);
    // Detect whether OCR was run due to corruption vs no text layer
    const ocrReason = /ocrReason=CORRUPTED_TEXT/i.test(extractedText)
      ? "CORRUPTED_TEXT"
      : /ocrReason=NO_TEXT_LAYER/i.test(extractedText)
        ? "NO_TEXT_LAYER"
        : null;
    const ocrConfigMissing =
      isCorrupted &&
      !ocrReason &&
      /OCR required but not configured|set PDF_OCR_ENABLED=true/i.test(extractedText);
    return {
      id: file.id,
      fileName: file.originalFileName || file.fileName,
      quality: assessExtractionQuality(file.extractedText, file.originalFileName || file.fileName),
      totalPages: file.totalPages,
      extractedPages: file.extractedPages,
      ocrPages: file.ocrPages,
      failedPages: file.failedPages,
      extractionScore: file.extractionScore,
      extractionMethod: file.extractionMethod,
      isCorrupted,
      ocrReason,
      ocrConfigMissing,
    };
  });
  const blockers = reports.filter((item) => item.quality.severity === "FAILED" || item.quality.severity === "POOR");
  const warnings = reports.filter((item) => item.quality.severity === "WARNING");
  const anyCorrupted = reports.some((item) => item.isCorrupted);
  const anyOcrRanForCorruption = reports.some((item) => item.ocrReason === "CORRUPTED_TEXT");
  const anyOcrMissing = reports.some((item) => item.ocrConfigMissing);
  const ready = blockers.length === 0 && !anyCorrupted;
  const analysisStatus = tender.analysisExtractionStatus;
  const isContaminated = tender.metadataContaminated;
  const isCorruptionBlocked = analysisStatus === "EXTRACTION_CORRUPTED_AI_SKIPPED" || anyCorrupted;

  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${ready ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide ${ready ? "text-green-700" : "text-red-700"}`}>Extraction quality</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">{ready ? "Extracted text appears usable" : "Extraction quality blockers found"}</h2>
          <p className="mt-1 text-sm text-slate-600">Preflight check for scanned PDFs, failed extraction, low text density, legacy DOC files, and table-heavy tender documents.</p>
        </div>
        <div className="flex items-center gap-2">
          {analysisStatus && (
            <span className={`rounded-full px-2 py-1 text-xs font-medium ${
              analysisStatus === "FULL_EXTRACTION_AI_ANALYZED" ? "bg-green-100 text-green-700"
              : analysisStatus === "PARTIAL_EXTRACTION_AI_ANALYZED" ? "bg-amber-100 text-amber-700"
              : "bg-red-100 text-red-700"
            }`}>
              {EXTRACTION_STATUS_LABELS[analysisStatus] ?? analysisStatus}
            </span>
          )}
          {!ready && (
            <a href="#legacy-tender-detail-actions" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100">
              Re-extract from PDF ↓
            </a>
          )}
          <Link href={`/api/tenders/${tenderId}/extraction-quality`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
            Open JSON
          </Link>
        </div>
      </div>

      {isContaminated && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Metadata contamination warning:</strong> The procuring entity / client name may be polluted by unrelated tender portal text or navigation content. Review and correct before generating documents or exporting.
        </div>
      )}

      {isCorruptionBlocked && (
        <div className="mt-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>Extraction corrupted / OCR required</strong> — text quality is too low for reliable analysis. The extracted text contains garbage characters (symbol runs, broken spacing, or icon-font glyphs) rather than readable document content. AI Analyze is blocked until the extraction quality issue is resolved.
        </div>
      )}

      {anyOcrRanForCorruption && (
        <div className="mt-3 rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <strong>OCR was run to improve quality</strong> — the original text layer was detected as corrupted (ocrReason=CORRUPTED_TEXT), so Claude vision OCR was applied automatically.
        </div>
      )}

      {anyOcrMissing && (
        <div className="mt-3 rounded-lg border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-800">
          <strong>OCR required but not configured</strong> — the extracted text is corrupted and OCR would improve it, but OCR is currently disabled. Set <code>PDF_OCR_ENABLED=true</code> in your environment variables to enable automatic OCR fallback.
        </div>
      )}

      {(blockers.length > 0 || warnings.length > 0) && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {[...blockers, ...warnings].slice(0, 6).map((item) => (
            <div key={item.id} className="rounded-xl border bg-white p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-slate-900">{item.fileName}</p>
                <div className="flex items-center gap-1">
                  {item.extractionMethod && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {item.extractionMethod}
                    </span>
                  )}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${item.quality.severity === "GOOD" ? "bg-green-100 text-green-700" : item.quality.severity === "WARNING" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                    {item.quality.severity} · {item.extractionScore !== null ? `${Math.round(item.extractionScore)}/100` : `${item.quality.score}/100`}
                  </span>
                </div>
              </div>
              {(item.totalPages !== null || item.extractedPages !== null) && (
                <p className="mt-1 text-xs text-slate-500">
                  {item.totalPages !== null && `${item.totalPages} pages total`}
                  {item.extractedPages !== null && ` · ${item.extractedPages} extracted`}
                  {item.ocrPages !== null && item.ocrPages > 0 && ` · ${item.ocrPages} OCR`}
                  {item.failedPages !== null && item.failedPages > 0 && ` · ${item.failedPages} failed`}
                </p>
              )}
              <p className="mt-1 text-xs text-slate-500">{item.quality.characterCount.toLocaleString()} characters{item.quality.averageCharsPerPage ? ` · ~${item.quality.averageCharsPerPage} chars/page` : ""}</p>
              {item.quality.warnings.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
                  {item.quality.warnings.slice(0, 3).map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
