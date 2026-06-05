import Link from "next/link";
import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { assessExtractionQuality, assessExtractionQualityPerPage } from "../lib/extraction-quality";
import { isExtractionCorrupted, summarizeExtractionCoverage } from "../lib/engine/extraction-quality-gate";

const EXTRACTION_STATUS_LABELS: Record<string, string> = {
  FULL_EXTRACTION_AI_ANALYZED: "Full extraction",
  PARTIAL_EXTRACTION_AI_ANALYZED: "Partial extraction",
  OCR_REQUIRED: "OCR required",
  EXTRACTION_WEAK_REVIEW_REQUIRED: "Weak — review required",
  REGEX_FALLBACK_FROM_WEAK_EXTRACTION: "Very poor — regex fallback",
  EXTRACTION_CORRUPTED_AI_SKIPPED: "Corrupted — AI blocked",
};

type ExtractedTextSampleRow = {
  id: string;
  extractedCharacterCount: number;
  extractedTextSample: string;
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
          mimeType: true, totalPages: true, extractedPages: true, ocrPages: true, failedPages: true,
          extractionScore: true, extractionMethod: true, ocrModel: true,
        },
      },
    },
  }).catch(() => null);
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
    const quality = assessExtractionQuality(file.extractedText, file.originalFileName || file.fileName);
    return {
      id: file.id,
      fileName: file.originalFileName || file.fileName,
      mimeType: file.mimeType,
      quality,
      perPage: assessExtractionQualityPerPage(file.extractedText),
      totalPages: file.totalPages,
      extractedPages: file.extractedPages,
      ocrPages: file.ocrPages,
      failedPages: file.failedPages,
      extractionScore: Math.min(file.extractionScore ?? quality.score, quality.score),
      extractionMethod: file.extractionMethod,
      ocrModel: file.ocrModel,
      ocrUsed: file.extractionMethod === "ocr" || (file.ocrPages !== null && file.ocrPages > 0) || ocrReason !== null,
      isCorrupted,
      ocrReason,
      ocrConfigMissing,
      extractedCharacterCount: quality.characterCount,
    };
  });

  const coverage = summarizeExtractionCoverage(reports.map((item) => ({
    id: item.id,
    fileName: item.fileName,
    totalPages: item.totalPages,
    extractedPages: item.extractedPages,
    ocrPages: item.ocrPages,
    failedPages: item.failedPages,
    extractionScore: item.extractionScore,
    extractionMethod: item.extractionMethod,
    characterCount: item.extractedCharacterCount,
  })));

  const blockers = reports.filter((item) => item.quality.severity === "FAILED" || item.quality.severity === "POOR");
  const warnings = reports.filter((item) => item.quality.severity === "WARNING");
  const anyCorrupted = reports.some((item) => item.isCorrupted);
  const anyOcrRanForCorruption = reports.some((item) => item.ocrReason === "CORRUPTED_TEXT");
  const anyOcrMissing = reports.some((item) => item.ocrConfigMissing);
  const analysisStatus = tender.analysisExtractionStatus;
  const isCorruptionBlocked = analysisStatus === "EXTRACTION_CORRUPTED_AI_SKIPPED" || anyCorrupted;
  // Never show "Extracted text appears usable" when extraction is confirmed corrupted.
  const ready = blockers.length === 0 && !anyCorrupted && analysisStatus !== "EXTRACTION_CORRUPTED_AI_SKIPPED" && coverage.totalPagesKnown && coverage.failedPages === 0;
  const isContaminated = tender.metadataContaminated;

  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${ready ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide ${ready ? "text-green-700" : "text-red-700"}`}>Extraction quality</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">{ready ? "Extracted text appears usable" : "Extraction quality blockers found"}</h2>
          <p className="mt-1 text-sm text-slate-600">Preflight check for scanned PDFs, failed extraction, low text density, legacy DOC files, and table-heavy tender documents.</p>
          <p className="mt-1 text-xs text-slate-500">Extraction coverage: {coverage.perfectlyExtractedPages}/{coverage.totalPagesKnown ? coverage.totalPages : "?"} perfectly extracted page(s) · {coverage.extractionCoveragePercent}% coverage</p>
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

      {/* Coverage stats grid */}
      <div className="mt-4 grid gap-3 md:grid-cols-5">
        <div className="rounded-xl border bg-white p-3 text-sm"><p className="text-xs uppercase text-slate-500">Total pages</p><p className="mt-1 text-xl font-bold text-slate-900">{coverage.totalPagesKnown ? coverage.totalPages : "Unknown"}</p></div>
        <div className="rounded-xl border bg-white p-3 text-sm"><p className="text-xs uppercase text-slate-500">Perfect pages</p><p className="mt-1 text-xl font-bold text-slate-900">{coverage.perfectlyExtractedPages}</p></div>
        <div className="rounded-xl border bg-white p-3 text-sm"><p className="text-xs uppercase text-slate-500">OCR pages</p><p className="mt-1 text-xl font-bold text-slate-900">{coverage.ocrPages}</p></div>
        <div className="rounded-xl border bg-white p-3 text-sm"><p className="text-xs uppercase text-slate-500">Weak pages</p><p className="mt-1 text-xl font-bold text-slate-900">{coverage.weakPages}</p></div>
        <div className="rounded-xl border bg-white p-3 text-sm"><p className="text-xs uppercase text-slate-500">Failed pages</p><p className="mt-1 text-xl font-bold text-slate-900">{coverage.failedPages}</p></div>
      </div>

      {(coverage.lowConfidencePages.length > 0 || coverage.failedPageList.length > 0 || coverage.recommendedActions.length > 0) && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-white p-4 text-sm">
          <p className="font-semibold text-slate-900">Extraction review list and recommended action</p>
          <div className="mt-3 grid gap-4 lg:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase text-amber-700">Low-confidence pages</p>
              {coverage.lowConfidencePages.length === 0 ? <p className="mt-1 text-xs text-slate-500">None reported.</p> : (
                <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-slate-700">
                  {coverage.lowConfidencePages.slice(0, 8).map((page, index) => <li key={`${page.fileName}-${page.page ?? "file"}-${index}`}>{page.fileName}{page.page ? ` p.${page.page}` : ""}: {page.reason}</li>)}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-red-700">Failed / missing pages</p>
              {coverage.failedPageList.length === 0 ? <p className="mt-1 text-xs text-slate-500">None reported.</p> : (
                <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-slate-700">
                  {coverage.failedPageList.slice(0, 8).map((page, index) => <li key={`${page.fileName}-${page.page ?? "file"}-${index}`}>{page.fileName}{page.page ? ` p.${page.page}` : ""}: {page.reason}</li>)}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-700">Recommended action</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-slate-700">
                {coverage.recommendedActions.map((action) => <li key={action}>{action}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}

      {!ready && !isCorruptionBlocked && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <span className="font-semibold">Recommended action: </span>
          {anyOcrMissing
            ? "Set PDF_OCR_ENABLED=true and re-extract — the document requires OCR."
            : reports.some((r) => r.quality.severity === "FAILED")
              ? "Re-upload the file or convert it to a clean, searchable PDF before running AI Analyze."
              : reports.some((r) => r.quality.scannedPdfLikely)
                ? "Enable OCR and re-import, or upload a clearer scan. AI Analyze may produce unreliable results on this file."
                : reports.some((r) => r.quality.averageCharsPerPage !== null && r.quality.averageCharsPerPage < 300)
                  ? "Review the file page-by-page; some pages may need manual transcription or a higher-quality scan."
                  : "Continue only if extraction quality is acceptable for your use case, or re-upload a better-quality version."}
        </div>
      )}

      {isCorruptionBlocked && (
        <div className="mt-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>Extraction corrupted / OCR required</strong> — text quality is too low for reliable analysis. The extracted text contains garbage characters (symbol runs, broken spacing, or icon-font glyphs) rather than readable document content. AI Analyze is blocked until the extraction quality issue is resolved.
        </div>
      )}


      {isContaminated && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Metadata contamination warning:</strong> The procuring entity / client name may be polluted by unrelated tender portal text or navigation content. Review and correct before generating documents or exporting.
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

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {reports.map((item) => {
          const pp = item.perPage;
          const totalDetected = pp.totalDetectedPages;
          const perfectCount = pp.perfectPages.length;
          const coveragePct = pp.coveragePercent;
          const hasProblemPages = pp.blankPages.length > 0 || pp.failedPages.length > 0 || pp.lowDensityPages.length > 0;
          return (
            <div key={item.id} className="rounded-xl border bg-white p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 truncate">{item.fileName}</p>
                  {item.mimeType && <p className="text-[10px] text-slate-400 truncate">{item.mimeType}</p>}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
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

              {/* Page coverage summary */}
              {totalDetected > 0 ? (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Extraction coverage</span>
                    <span className={`font-medium ${coveragePct >= 80 ? "text-green-700" : coveragePct >= 50 ? "text-amber-700" : "text-red-700"}`}>
                      {perfectCount}/{totalDetected} pages ({coveragePct}%)
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full rounded-full ${coveragePct >= 80 ? "bg-green-500" : coveragePct >= 50 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${coveragePct}%` }} />
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-slate-500 mt-1">
                    {pp.ocrPages.length > 0 && <span>OCR pages: {pp.ocrPages.length}</span>}
                    {pp.blankPages.length > 0 && <span className="text-amber-700">Blank: {pp.blankPages.length}</span>}
                    {pp.lowDensityPages.length > 0 && <span className="text-amber-700">Low-density: {pp.lowDensityPages.length}</span>}
                    {pp.failedPages.length > 0 && <span className="text-red-700">Failed: {pp.failedPages.length}</span>}
                    {pp.tableHeavyPages.length > 0 && <span>Table-heavy: {pp.tableHeavyPages.length}</span>}
                  </div>
                  {/* Key content pages */}
                  {(pp.submissionInstructionPages.length > 0 || pp.evaluationCriteriaPages.length > 0 || pp.clientDetailPages.length > 0 || pp.requiredDocumentPages.length > 0) && (
                    <div className="mt-1.5 space-y-0.5 text-xs text-slate-500 border-t pt-1.5">
                      {pp.submissionInstructionPages.length > 0 && (
                        <div>Submission instructions: pp.{pp.submissionInstructionPages.slice(0, 5).join(", ")}{pp.submissionInstructionPages.length > 5 ? "…" : ""}</div>
                      )}
                      {pp.evaluationCriteriaPages.length > 0 && (
                        <div>Evaluation criteria: pp.{pp.evaluationCriteriaPages.slice(0, 5).join(", ")}{pp.evaluationCriteriaPages.length > 5 ? "…" : ""}</div>
                      )}
                      {pp.clientDetailPages.length > 0 && (
                        <div>Client/contact details: pp.{pp.clientDetailPages.slice(0, 5).join(", ")}{pp.clientDetailPages.length > 5 ? "…" : ""}</div>
                      )}
                      {pp.requiredDocumentPages.length > 0 && (
                        <div>Required documents: pp.{pp.requiredDocumentPages.slice(0, 5).join(", ")}{pp.requiredDocumentPages.length > 5 ? "…" : ""}</div>
                      )}
                    </div>
                  )}
                  {/* Problem page numbers */}
                  {hasProblemPages && (
                    <div className="mt-1.5 border-t pt-1.5 space-y-0.5 text-xs">
                      {pp.failedPages.length > 0 && (
                        <p className="text-red-700">Failed pages: {pp.failedPages.slice(0, 10).join(", ")}{pp.failedPages.length > 10 ? "…" : ""}</p>
                      )}
                      {pp.blankPages.length > 0 && (
                        <p className="text-amber-700">Blank pages: {pp.blankPages.slice(0, 10).join(", ")}{pp.blankPages.length > 10 ? "…" : ""}</p>
                      )}
                      {pp.lowDensityPages.length > 0 && (
                        <p className="text-amber-700">Low-density pages: {pp.lowDensityPages.slice(0, 10).join(", ")}{pp.lowDensityPages.length > 10 ? "…" : ""}</p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-xs text-slate-500">
                  {(item.totalPages !== null) && `${item.totalPages} pages total`}
                  {(item.extractedPages !== null) && ` · ${item.extractedPages} extracted`}
                  {(item.ocrPages !== null && item.ocrPages > 0) && ` · ${item.ocrPages} OCR`}
                  {(item.failedPages !== null && item.failedPages > 0) && ` · ${item.failedPages} failed`}
                </p>
              )}

              <p className="mt-1 text-xs text-slate-400">
                {item.quality.characterCount.toLocaleString()} chars{item.quality.averageCharsPerPage ? ` · ~${item.quality.averageCharsPerPage}/page` : ""}
                {" · "}
                <span className={item.ocrUsed ? "text-blue-600 font-medium" : ""}>
                  OCR: {item.extractionMethod === "ocr" ? "Yes (full)" : (item.ocrPages !== null && item.ocrPages > 0) ? `Yes (${item.ocrPages} pages)` : item.ocrReason ? "Yes (auto)" : "No"}
                </span>
                {item.ocrModel && <span> · {item.ocrModel}</span>}
              </p>

              {item.quality.warnings.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
                  {item.quality.warnings.slice(0, 3).map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              )}
              {item.quality.recommendations.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-semibold text-slate-600">Recommended action:</p>
                  <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-xs text-slate-600">
                    {item.quality.recommendations.slice(0, 2).map((rec) => <li key={rec}>{rec}</li>)}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
