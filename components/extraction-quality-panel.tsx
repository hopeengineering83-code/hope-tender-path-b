import Link from "next/link";
import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { assessExtractionQuality, assessExtractionQualityPerPage, buildReportFromStoredPages, type PageQualityEntry, type PerPageExtractionReport } from "../lib/extraction-quality";
import { isExtractionCorrupted } from "../lib/engine/extraction-quality-gate";
import { ArrowRightIcon } from "./icons";
import { DisclosureAnchorLink } from "./disclosure-anchor-link";

const EXTRACTION_STATUS_LABELS: Record<string, string> = {
  FULL_EXTRACTION_AI_ANALYZED: "Full extraction",
  PARTIAL_EXTRACTION_AI_ANALYZED: "Partial extraction",
  OCR_REQUIRED: "OCR required",
  EXTRACTION_WEAK_REVIEW_REQUIRED: "Weak — review required",
  REGEX_FALLBACK_FROM_WEAK_EXTRACTION: "Very poor — regex fallback",
  EXTRACTION_CORRUPTED_AI_SKIPPED: "Corrupted — AI blocked",
};

function uniquePages(pages: number[]): number[] {
  return [...new Set(pages.filter((p) => Number.isFinite(p)).map((p) => Math.max(1, Math.floor(p))))].sort((a, b) => a - b);
}

function formatPages(pages: number[], max = 8) {
  const clean = uniquePages(pages);
  if (clean.length === 0) return "None";
  return clean.slice(0, max).join(", ") + (clean.length > max ? "…" : "");
}

function storedPages(rawPageStatus: string | null | undefined): PageQualityEntry[] | null {
  if (!rawPageStatus) return null;
  try {
    const parsed = JSON.parse(rawPageStatus);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((item) => item && typeof item === "object") as PageQualityEntry[];
  } catch {
    return null;
  }
}

function isWeakStatus(status: string) {
  return status === "LOW_DENSITY" || status === "TABLE_HEAVY" || status === "IMAGE_HEAVY" || status === "OCR";
}

function isFailedStatus(status: string) {
  return status === "FAILED" || status === "BLANK";
}

function aggregatePageStatus(reports: Array<{ fileName: string; perPage: PerPageExtractionReport }>) {
  let total = 0;
  let good = 0;
  let weak = 0;
  let failed = 0;
  let ocr = 0;
  const lowConfidencePages: Array<{ fileName: string; page: number; reason: string }> = [];
  const failedPages: Array<{ fileName: string; page: number; reason: string }> = [];
  const submissionPages: number[] = [];
  const evaluationPages: number[] = [];
  const clientPages: number[] = [];
  const requiredDocPages: number[] = [];

  for (const report of reports) {
    total += report.perPage.totalDetectedPages;
    good += report.perPage.perfectPages.length;
    ocr += report.perPage.ocrPages.length;
    submissionPages.push(...report.perPage.submissionInstructionPages);
    evaluationPages.push(...report.perPage.evaluationCriteriaPages);
    clientPages.push(...report.perPage.clientDetailPages);
    requiredDocPages.push(...report.perPage.requiredDocumentPages);
    for (const page of report.perPage.pages) {
      if (isWeakStatus(page.status)) {
        weak += 1;
        lowConfidencePages.push({ fileName: report.fileName, page: page.page, reason: page.status.replace(/_/g, " ").toLowerCase() });
      }
      if (isFailedStatus(page.status)) {
        failed += 1;
        failedPages.push({ fileName: report.fileName, page: page.page, reason: page.status.replace(/_/g, " ").toLowerCase() });
      }
    }
  }

  const coveragePercent = total > 0 ? Math.round((good / total) * 100) : 0;
  return { total, good, weak, failed, ocr, coveragePercent, lowConfidencePages, failedPages, submissionPages, evaluationPages, clientPages, requiredDocPages };
}

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
          id: true, fileName: true, originalFileName: true,
          mimeType: true, totalPages: true, extractedPages: true, ocrPages: true, failedPages: true,
          extractionScore: true, extractionMethod: true, ocrModel: true, pageStatusJson: true,
        },
      },
    },
  }).catch(() => null);
  if (!tender || tender.files.length === 0) return null;

  const fileIds = tender.files.map((f) => f.id);
  type SampleRow = { id: string; extractedTextSample: string; extractedCharacterCount: number };
  const samples: SampleRow[] = fileIds.length > 0
    ? await prisma.$queryRaw<SampleRow[]>`
        SELECT id,
               LEFT(COALESCE("extractedText", ''), 6000) AS "extractedTextSample",
               char_length("extractedText")              AS "extractedCharacterCount"
        FROM "TenderFile"
        WHERE id = ANY(${fileIds}::text[])
      `.catch(() => [])
    : [];
  const sampleById = new Map(samples.map((s) => [s.id, s]));

  const reports = tender.files.map((file) => {
    const sample = sampleById.get(file.id);
    const extractedText = sample?.extractedTextSample ?? "";
    const isCorrupted = extractedText.length > 20 && isExtractionCorrupted(extractedText);
    const ocrReason = /ocrReason=CORRUPTED_TEXT/i.test(extractedText)
      ? "CORRUPTED_TEXT"
      : /ocrReason=NO_TEXT_LAYER/i.test(extractedText)
        ? "NO_TEXT_LAYER"
        : null;
    const ocrConfigMissing = isCorrupted && !ocrReason && /OCR required but not configured|set PDF_OCR_ENABLED=true/i.test(extractedText);
    const quality = assessExtractionQuality(extractedText, file.originalFileName || file.fileName);
    const stored = storedPages(file.pageStatusJson);
    const perPage = stored && stored.length > 0 ? buildReportFromStoredPages(stored) : assessExtractionQualityPerPage(extractedText);
    return {
      id: file.id,
      fileName: file.originalFileName || file.fileName,
      mimeType: file.mimeType,
      quality,
      perPage,
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
      extractedCharacterCount: sample?.extractedCharacterCount ?? quality.characterCount,
    };
  });

  const pageCoverage = aggregatePageStatus(reports.map((item) => ({ fileName: item.fileName, perPage: item.perPage })));
  const blockers = reports.filter((item) => item.quality.severity === "FAILED" || item.quality.severity === "POOR");
  const anyCorrupted = reports.some((item) => item.isCorrupted);
  const anyOcrRanForCorruption = reports.some((item) => item.ocrReason === "CORRUPTED_TEXT");
  const anyOcrMissing = reports.some((item) => item.ocrConfigMissing);
  const analysisStatus = tender.analysisExtractionStatus;
  const isCorruptionBlocked = analysisStatus === "EXTRACTION_CORRUPTED_AI_SKIPPED" || anyCorrupted;
  const hasWeakOrFailedPages = pageCoverage.weak > 0 || pageCoverage.failed > 0;
  const ready = blockers.length === 0 && !anyCorrupted && analysisStatus !== "EXTRACTION_CORRUPTED_AI_SKIPPED" && pageCoverage.total > 0 && pageCoverage.coveragePercent >= 80 && pageCoverage.failed === 0;
  const isContaminated = tender.metadataContaminated;

  return (
    <section id="extraction-quality-detail" className={`mb-4 rounded-2xl border p-5 shadow-sm ${ready ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide ${ready ? "text-green-700" : "text-amber-800"}`}>Extraction quality</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">{ready ? "Extracted text appears usable" : "Extraction needs review"}</h2>
          <p className="mt-1 text-sm text-slate-600">Preflight check for scanned PDFs, failed extraction, low text density, blank pages, and table-heavy tender documents.</p>
          <p className="mt-1 text-xs text-slate-500">Page-status coverage: {pageCoverage.good}/{pageCoverage.total || "?"} good page(s) · {pageCoverage.coveragePercent}% coverage</p>
        </div>
        <div className="flex items-center gap-2">
          {analysisStatus && (
            <span className={`rounded-full px-2 py-1 text-xs font-medium ${analysisStatus === "FULL_EXTRACTION_AI_ANALYZED" ? "bg-green-100 text-green-700" : analysisStatus === "PARTIAL_EXTRACTION_AI_ANALYZED" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"}`}>
              {EXTRACTION_STATUS_LABELS[analysisStatus] ?? analysisStatus}
            </span>
          )}
          {!ready && <DisclosureAnchorLink href="#tender-edit-form" className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100">Re-extract / review <ArrowRightIcon /></DisclosureAnchorLink>}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-5">
        <div className="rounded-xl border bg-white p-3 text-sm"><p className="text-xs uppercase text-slate-500">Detected pages</p><p className="mt-1 text-xl font-bold text-slate-900">{pageCoverage.total || "Unknown"}</p></div>
        <div className="rounded-xl border bg-white p-3 text-sm"><p className="text-xs uppercase text-slate-500">Good pages</p><p className="mt-1 text-xl font-bold text-slate-900">{pageCoverage.good}</p></div>
        <div className="rounded-xl border bg-white p-3 text-sm"><p className="text-xs uppercase text-slate-500">OCR pages</p><p className="mt-1 text-xl font-bold text-slate-900">{pageCoverage.ocr}</p></div>
        <div className="rounded-xl border bg-white p-3 text-sm"><p className="text-xs uppercase text-slate-500">Weak pages</p><p className="mt-1 text-xl font-bold text-slate-900">{pageCoverage.weak}</p></div>
        <div className="rounded-xl border bg-white p-3 text-sm"><p className="text-xs uppercase text-slate-500">Blank/failed pages</p><p className="mt-1 text-xl font-bold text-slate-900">{pageCoverage.failed}</p></div>
      </div>

      {pageCoverage.total > 0 && (
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border bg-white p-3 text-sm">
            <p className="text-xs uppercase text-slate-500">Submission instruction pages</p>
            {pageCoverage.submissionPages.length > 0
              ? <><p className="mt-1 text-xl font-bold text-green-700">{pageCoverage.submissionPages.length}</p><p className="text-[10px] text-slate-400">pp. {formatPages(pageCoverage.submissionPages, 6)}</p></>
              : <p className="mt-1 text-sm font-semibold text-amber-600">None detected</p>}
          </div>
          <div className="rounded-xl border bg-white p-3 text-sm">
            <p className="text-xs uppercase text-slate-500">Evaluation criteria pages</p>
            {pageCoverage.evaluationPages.length > 0
              ? <><p className="mt-1 text-xl font-bold text-green-700">{pageCoverage.evaluationPages.length}</p><p className="text-[10px] text-slate-400">pp. {formatPages(pageCoverage.evaluationPages, 6)}</p></>
              : <p className="mt-1 text-sm font-semibold text-amber-600">None detected</p>}
          </div>
          <div className="rounded-xl border bg-white p-3 text-sm">
            <p className="text-xs uppercase text-slate-500">Required documents pages</p>
            {pageCoverage.requiredDocPages.length > 0
              ? <><p className="mt-1 text-xl font-bold text-green-700">{pageCoverage.requiredDocPages.length}</p><p className="text-[10px] text-slate-400">pp. {formatPages(pageCoverage.requiredDocPages, 6)}</p></>
              : <p className="mt-1 text-sm font-semibold text-amber-600">None detected</p>}
          </div>
          <div className="rounded-xl border bg-white p-3 text-sm">
            <p className="text-xs uppercase text-slate-500">Client/contact detail pages</p>
            {pageCoverage.clientPages.length > 0
              ? <><p className="mt-1 text-xl font-bold text-green-700">{pageCoverage.clientPages.length}</p><p className="text-[10px] text-slate-400">pp. {formatPages(pageCoverage.clientPages, 6)}</p></>
              : <p className="mt-1 text-sm font-semibold text-amber-600">None detected</p>}
          </div>
        </div>
      )}

      {(hasWeakOrFailedPages || pageCoverage.lowConfidencePages.length > 0) && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-white p-4 text-sm">
          <p className="font-semibold text-slate-900">Extraction review list and recommended action</p>
          <div className="mt-3 grid gap-4 lg:grid-cols-3">
            <div><p className="text-xs font-semibold uppercase text-amber-800">Low-confidence pages</p>{pageCoverage.lowConfidencePages.length === 0 ? <p className="mt-1 text-xs text-slate-500">None reported.</p> : <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-slate-700">{pageCoverage.lowConfidencePages.slice(0, 10).map((page, index) => <li key={`${page.fileName}-${page.page}-${index}`}>{page.fileName} p.{page.page}: {page.reason}</li>)}</ul>}</div>
            <div><p className="text-xs font-semibold uppercase text-red-700">Blank / failed pages</p>{pageCoverage.failedPages.length === 0 ? <p className="mt-1 text-xs text-slate-500">None reported.</p> : <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-slate-700">{pageCoverage.failedPages.slice(0, 10).map((page, index) => <li key={`${page.fileName}-${page.page}-${index}`}>{page.fileName} p.{page.page}: {page.reason}</li>)}</ul>}</div>
            <div><p className="text-xs font-semibold uppercase text-slate-700">Recommended action</p><ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-slate-700">{pageCoverage.failed > 0 && <li>Re-extract the file or upload a cleaner source because blank/failed pages were detected.</li>}{pageCoverage.weak > 0 && <li>Review weak/table-heavy pages manually before relying on AI Analyze.</li>}{pageCoverage.coveragePercent < 80 && <li>Do not treat this as full extraction; page-status coverage is below 80%.</li>}{pageCoverage.coveragePercent >= 80 && pageCoverage.failed === 0 && <li>Continue only after reviewing weak/table-heavy pages.</li>}</ul></div>
          </div>
        </div>
      )}

      {(analysisStatus === "PARTIAL_EXTRACTION_AI_ANALYZED" || analysisStatus === "EXTRACTION_WEAK_REVIEW_REQUIRED" || analysisStatus === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION") && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Warning: document is only partially extracted.</strong> AI Analyze ran on incomplete extraction ({EXTRACTION_STATUS_LABELS[analysisStatus] ?? analysisStatus}). Results may be missing tender pages. Re-extract or run OCR for a more reliable analysis.
        </div>
      )}
      {!ready && !isCorruptionBlocked && <div className="mt-3 rounded-lg border border-amber-200 bg-white px-4 py-2.5 text-xs text-amber-900"><span className="font-semibold">Recommended action: </span>{anyOcrMissing ? "Set PDF_OCR_ENABLED=true and re-extract — the document requires OCR." : pageCoverage.failed > 0 ? "Re-upload or re-extract the file. Blank/failed pages mean extraction is not fully reliable." : pageCoverage.coveragePercent < 80 ? "Review or re-extract before AI Analyze. The page-status coverage is below the safe threshold." : "Continue only if the weak/table-heavy pages are acceptable for this tender."}</div>}
      {isCorruptionBlocked && <div className="mt-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"><strong>Extraction corrupted / OCR required</strong> — text quality is too low for reliable analysis. AI Analyze is blocked until the extraction quality issue is resolved.</div>}
      {isContaminated && <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800"><strong>Client entity contamination warning:</strong> The procuring entity / client name may be polluted by unrelated tender portal text or navigation content. Review and correct before generating documents or exporting.</div>}
      {anyOcrRanForCorruption && <div className="mt-3 rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-800"><strong>OCR was run to improve quality</strong> — the original text layer was detected as corrupted, so OCR was applied automatically.</div>}
      {anyOcrMissing && <div className="mt-3 rounded-lg border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-800"><strong>OCR required but not configured</strong> — the extracted text is corrupted and OCR would improve it, but OCR is currently disabled.</div>}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {reports.map((item) => {
          const pp = item.perPage;
          const totalDetected = pp.totalDetectedPages;
          const goodCount = pp.perfectPages.length;
          const coveragePct = pp.coveragePercent;
          const hasProblemPages = pp.blankPages.length > 0 || pp.failedPages.length > 0 || pp.lowDensityPages.length > 0 || pp.tableHeavyPages.length > 0 || pp.imageHeavyPages.length > 0;
          return (
            <div key={item.id} className="rounded-xl border bg-white p-3 text-sm">
              <div className="flex items-center justify-between gap-2"><div className="min-w-0"><p className="font-medium text-slate-900 truncate">{item.fileName}</p>{item.mimeType && <p className="text-[10px] text-slate-400 truncate">{item.mimeType}</p>}</div><div className="flex items-center gap-1 flex-shrink-0">{item.extractionMethod && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{item.extractionMethod}</span>}<span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${item.quality.severity === "GOOD" && coveragePct >= 80 ? "bg-green-100 text-green-700" : item.quality.severity === "FAILED" || item.quality.severity === "POOR" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>{item.quality.severity} · {item.extractionScore !== null ? `${Math.round(item.extractionScore)}/100` : `${item.quality.score}/100`}</span></div></div>
              {totalDetected > 0 ? <div className="mt-2 space-y-1"><div className="flex items-center justify-between text-xs text-slate-500"><span>Page-status coverage</span><span className={`font-medium ${coveragePct >= 80 ? "text-green-700" : coveragePct >= 50 ? "text-amber-800" : "text-red-700"}`}>{goodCount}/{totalDetected} pages ({coveragePct}%)</span></div><div className="h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full ${coveragePct >= 80 ? "bg-green-500" : coveragePct >= 50 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${coveragePct}%` }} /></div>{item.totalPages && item.totalPages !== totalDetected && <p className="text-[11px] text-amber-800">Stored file page count is {item.totalPages}, but page-status review has {totalDetected} page row(s). Re-extract if this mismatch persists.</p>}<div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-slate-500 mt-1">{pp.ocrPages.length > 0 && <span>OCR pages: {pp.ocrPages.length}</span>}{pp.blankPages.length > 0 && <span className="text-amber-800">Blank: {pp.blankPages.length}</span>}{pp.lowDensityPages.length > 0 && <span className="text-amber-800">Low-density: {pp.lowDensityPages.length}</span>}{pp.failedPages.length > 0 && <span className="text-red-700">Failed: {pp.failedPages.length}</span>}{pp.tableHeavyPages.length > 0 && <span>Table-heavy: {pp.tableHeavyPages.length}</span>}{pp.imageHeavyPages.length > 0 && <span>Image/scan pages: {pp.imageHeavyPages.length}</span>}</div>{(pp.submissionInstructionPages.length > 0 || pp.evaluationCriteriaPages.length > 0 || pp.clientDetailPages.length > 0 || pp.requiredDocumentPages.length > 0) && <div className="mt-1.5 space-y-0.5 text-xs text-slate-500 border-t pt-1.5">{pp.submissionInstructionPages.length > 0 && <div>Submission instructions: pp.{formatPages(pp.submissionInstructionPages, 5)}</div>}{pp.evaluationCriteriaPages.length > 0 && <div>Evaluation criteria: pp.{formatPages(pp.evaluationCriteriaPages, 5)}</div>}{pp.clientDetailPages.length > 0 && <div>Client/contact details: pp.{formatPages(pp.clientDetailPages, 5)}</div>}{pp.requiredDocumentPages.length > 0 && <div>Required documents: pp.{formatPages(pp.requiredDocumentPages, 5)}</div>}</div>}{hasProblemPages && <div className="mt-1.5 border-t pt-1.5 space-y-0.5 text-xs">{pp.failedPages.length > 0 && <p className="text-red-700">Failed pages: {formatPages(pp.failedPages, 10)}</p>}{pp.blankPages.length > 0 && <p className="text-amber-800">Blank pages: {formatPages(pp.blankPages, 10)}</p>}{pp.lowDensityPages.length > 0 && <p className="text-amber-800">Low-density pages: {formatPages(pp.lowDensityPages, 10)}</p>}{pp.imageHeavyPages.length > 0 && <p className="text-slate-600">Image/scan pages: {formatPages(pp.imageHeavyPages, 10)}</p>}</div>}</div> : <p className="mt-1 text-xs text-slate-500">No page-status rows are available. Re-run extraction or AI Analyze to rebuild page diagnostics.</p>}
              <p className="mt-1 text-xs text-slate-400">{item.extractedCharacterCount.toLocaleString()} chars{item.quality.averageCharsPerPage ? ` · ~${item.quality.averageCharsPerPage}/page` : ""}{" · "}<span className={item.ocrUsed ? "text-blue-600 font-medium" : ""}>OCR: {item.extractionMethod === "ocr" ? "Yes (full)" : (item.ocrPages !== null && item.ocrPages > 0) ? `Yes (${item.ocrPages} pages)` : item.ocrReason ? "Yes (auto)" : "No"}</span>{item.ocrModel && <span> · {item.ocrModel}</span>}</p>
              {item.quality.warnings.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">{item.quality.warnings.slice(0, 3).map((warning) => <li key={warning}>{warning}</li>)}</ul>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
