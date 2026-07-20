import { prisma, prismaReady } from "../lib/prisma";
import { assessExtractionQuality, assessExtractionQualityPerPage } from "../lib/extraction-quality";
import { isExtractionCorrupted } from "../lib/engine/extraction-quality-gate";
import { scoreToSeverity, severityBadgeClasses, severityTextClass } from "../lib/ui-tokens";
import { WarningIcon, DocumentIcon } from "./icons";

type FileStatus = "GOOD" | "ACCEPTABLE" | "POOR";

function getStatus(score: number): FileStatus {
  if (score >= 75) return "GOOD";
  if (score >= 45) return "ACCEPTABLE";
  return "POOR";
}

function fileStatusSeverity(status: FileStatus) {
  if (status === "GOOD") return "good" as const;
  if (status === "ACCEPTABLE") return "warning" as const;
  return "poor" as const;
}

function statusPill(status: FileStatus) {
  const sev = fileStatusSeverity(status);
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${severityBadgeClasses(sev)}`}>
      {status}
    </span>
  );
}

function scoreBadge(score: number, status: FileStatus) {
  const sev = fileStatusSeverity(status);
  return (
    <span className={`rounded-lg border px-2 py-1 text-xs font-bold tabular-nums ${severityBadgeClasses(sev)}`}>
      {Math.round(score)}/100
    </span>
  );
}

function pageList(nums: number[], maxInline = 12): string {
  if (nums.length === 0) return "";
  const sorted = [...nums].sort((a, b) => a - b);
  if (sorted.length <= maxInline) return `p. ${sorted.join(", ")}`;
  return `p. ${sorted.slice(0, maxInline).join(", ")} +${sorted.length - maxInline} more`;
}

function sectionCountLabel(count: number | null, documentLevel: boolean) {
  if (count === null) return "—";
  if (count <= 0) return "0";
  return documentLevel ? "All pages" : `${count}p`;
}

export async function ExtractionQualityDashboard({ tenderId }: { tenderId: string }) {
  try {
    await prismaReady;

    const files = await prisma.tenderFile.findMany({
      where: { tenderId },
      select: {
        id: true,
        originalFileName: true,
        fileName: true,
        mimeType: true,
        totalPages: true,
        extractedPages: true,
        ocrPages: true,
        failedPages: true,
        extractionScore: true,
        extractedText: true,
        ocrModel: true,
      },
      orderBy: { createdAt: "asc" },
    });

    if (files.length === 0) {
      return (
        <section id="extraction-quality" className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <DocumentIcon aria-hidden="true" />
            <h2 className="text-base font-semibold text-slate-700">Extraction Quality</h2>
          </div>
          <p className="mt-2 text-sm text-slate-500">No files uploaded yet.</p>
        </section>
      );
    }

    const fileData = files.map((file) => {
      const name = file.originalFileName || file.fileName;
      const text = file.extractedText ?? null;
      const textSample = text ? text.slice(0, 200) : null;
      const corrupted =
        textSample && textSample.trim().length > 20
          ? isExtractionCorrupted(textSample)
          : false;
      const quality = assessExtractionQuality(text, name);
      const rawScore =
        file.extractionScore !== null && file.extractionScore !== undefined
          ? file.extractionScore
          : quality.score;
      const score = Math.min(rawScore, quality.score);
      const status = getStatus(score);

      const totalPages = file.totalPages ?? null;
      const extractedPages = file.extractedPages ?? null;
      const ocrPages = file.ocrPages ?? null;
      const failedPages = file.failedPages ?? null;

      const coverage =
        totalPages !== null && totalPages > 0 && extractedPages !== null
          ? Math.round((extractedPages / totalPages) * 100)
          : null;

      const notYetExtracted = text === null;

      const fileType =
        file.mimeType === "application/pdf"
          ? "PDF"
          : file.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            ? "DOCX"
            : file.mimeType === "application/msword"
              ? "DOC"
              : file.mimeType
                ? file.mimeType.split("/").pop()?.toUpperCase() ?? null
                : file.fileName?.split(".").pop()?.toUpperCase() ?? null;

      const perPage = text ? assessExtractionQualityPerPage(text) : null;
      const detectionMode = perPage?.detectionMode ?? "EMPTY";
      const documentLevelDetection = detectionMode === "DOCUMENT_LEVEL";
      const perfectPages = perPage?.pages.filter((p) => p.status === "GOOD").length ?? null;

      // Per-page analysis: perfectly extracted pages (status GOOD)
      const perfectPagesCount = perPage?.perfectPages.length ?? null;
      // Use per-page coverage (perfect pages / total detected) when available, else file-level
      const perPageCoverage =
        perPage && totalPages && totalPages > 0 && perfectPagesCount !== null
          ? Math.round((perfectPagesCount / totalPages) * 100)
          : coverage;

      return {
        id: file.id,
        name,
        fileType,
        totalPages,
        extractedPages,
        perfectPagesCount,
        ocrPages,
        failedPages,
        perfectPages,
        ocrModel: file.ocrModel ?? null,
        blankPages: perPage?.blankPages.length ?? null,
        coverage: perPageCoverage,
        corrupted,
        score,
        status,
        quality,
        notYetExtracted,
        detectionMode,
        documentLevelDetection,
        submissionPages: perPage?.submissionInstructionPages.length ?? null,
        evaluationPages: perPage?.evaluationCriteriaPages.length ?? null,
        requiredDocPages: perPage?.requiredDocumentPages.length ?? null,
        clientDetailPages: perPage?.clientDetailPages.length ?? null,
        characterCount: quality.characterCount,
        // Average characters per extracted page — the clearest "low text
        // density" signal (CLAUDE.md item 7). Null when the page count is
        // unknown (e.g. DOCX whole-document detection).
        averageCharsPerPage: quality.averageCharsPerPage,
        ocrUsed: (file.ocrPages != null && file.ocrPages > 0) || file.ocrModel != null,
        // Page number lists for CLAUDE.md "failed pages list" and "low-confidence pages list"
        failedPageNums: perPage?.failedPages ?? [],
        blankPageNums: perPage?.blankPages ?? [],
        lowDensityPageNums: perPage?.lowDensityPages ?? [],
        ocrPageNums: perPage?.ocrPages ?? [],
        tableHeavyPageNums: perPage?.tableHeavyPages ?? [],
        imageHeavyPageNums: perPage?.imageHeavyPages ?? [],
        perPageEntries: perPage?.pages ?? [],
      };
    });

    const anyPoor = fileData.some((f) => f.status === "POOR" || f.corrupted);
    const allGood = fileData.every((f) => f.status === "GOOD" && !f.corrupted);

    // Compute overall coverage summary across all files
    const totalPagesOverall = fileData.reduce((sum, f) => sum + (f.totalPages ?? 0), 0);
    const extractedPagesOverall = fileData.reduce((sum, f) => sum + (f.extractedPages ?? 0), 0);
    const overallCoverage = totalPagesOverall > 0 ? Math.round((extractedPagesOverall / totalPagesOverall) * 100) : null;

    const headerBadge = anyPoor ? (
      <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">
        Action Required
      </span>
    ) : allGood ? (
      <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">
        All Clear
      </span>
    ) : (
      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
        Review Recommended
      </span>
    );

    let recommendedAction: string;
    if (fileData.some((f) => f.corrupted)) {
      recommendedAction =
        "Enable OCR or upload a clearer scan before running AI Analyze";
    } else if (fileData.some((f) => f.score < 45)) {
      recommendedAction = "Re-extract or upload a higher-quality PDF/DOCX";
    } else if (fileData.some((f) => f.score < 75)) {
      recommendedAction = "Review extraction quality before generating documents";
    } else {
      recommendedAction =
        "Extraction quality is acceptable. Proceed with AI Analyze.";
    }

    return (
      <section id="extraction-quality" className="mb-4 rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <DocumentIcon className="text-lg" aria-hidden="true" />
            <div>
              <h2 className="text-base font-bold text-slate-900">Extraction Quality</h2>
              <p className="text-xs text-slate-500">
                Per-file breakdown of extraction coverage and tender-section detection
              </p>
              {overallCoverage !== null && (
                <p className="mt-1.5 text-xs font-medium text-slate-700">
                  Overall coverage: <span className={overallCoverage >= 95 ? "text-green-700" : overallCoverage >= 50 ? "text-amber-800" : "text-red-700"}>{extractedPagesOverall}/{totalPagesOverall} pages ({overallCoverage}%)</span>
                </p>
              )}
            </div>
          </div>
          {headerBadge}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {fileData.map((file) => (
            <div
              key={file.id}
              className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{file.name}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    {file.fileType && (
                      <span className="text-xs uppercase text-slate-400">{file.fileType}</span>
                    )}
                    {statusPill(file.status)}
                    {file.documentLevelDetection && (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                        Document-level detection
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex-shrink-0">{scoreBadge(file.score, file.status)}</div>
              </div>

              {file.notYetExtracted ? (
                <p className="mt-3 text-xs italic text-slate-500">Not yet extracted</p>
              ) : (
                <>
                  <div className="mt-3 grid grid-cols-6 gap-2 text-center">
                    {(
                      [
                        ["Total", file.totalPages, "slate"],
                        ["Extracted", file.extractedPages, "slate"],
                        ["Perfect", file.perfectPagesCount, file.perfectPagesCount && file.totalPages ? file.perfectPagesCount < file.totalPages * 0.5 ? "amber" : "slate" : "slate"],
                        ["OCR", file.ocrPages, "slate"],
                        ["Blank", file.blankPages, file.blankPages ? "amber" : "slate"],
                        ["Failed", file.failedPages, file.failedPages ? "red" : "slate"],
                      ] as [string, number | null, string][]
                    ).map(([label, value, tone]) => (
                      <div key={label} className="rounded-lg border bg-white px-2 py-2">
                        <p className="text-[10px] uppercase text-slate-400">{label}</p>
                        <p className={`mt-0.5 text-base font-bold ${tone === "red" ? "text-red-700" : tone === "green" ? "text-green-700" : tone === "amber" ? "text-amber-800" : "text-slate-800"}`}>
                          {value !== null ? (
                            value
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                    <span>
                      OCR used:{" "}
                      <span className={`font-medium ${file.ocrUsed ? "text-blue-700" : "text-slate-600"}`}>
                        {file.ocrUsed ? "Yes" : "No"}
                      </span>
                    </span>
                    {file.ocrModel && (
                      <span>
                        OCR engine: <span className="font-medium text-slate-700">{file.ocrModel}</span>
                      </span>
                    )}
                    {file.characterCount > 0 && (
                      <span>
                        Chars extracted:{" "}
                        <span className="font-medium text-slate-700">{file.characterCount.toLocaleString()}</span>
                      </span>
                    )}
                    {file.averageCharsPerPage !== null && (
                      <span>
                        Text density:{" "}
                        <span className={`font-medium ${file.averageCharsPerPage < 300 ? "text-amber-800" : "text-slate-700"}`}>
                          {file.averageCharsPerPage.toLocaleString()} chars/page
                          {file.averageCharsPerPage < 300 ? " (low)" : ""}
                        </span>
                      </span>
                    )}
                  </div>

                  {/* Per-page confidence detail — only shown when PAGE_MARKERS detection found problem pages */}
                  {file.detectionMode === "PAGE_MARKERS" && (file.failedPageNums.length > 0 || file.lowDensityPageNums.length > 0) && (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-2">
                      <p className="mb-1.5 text-[10px] font-semibold uppercase text-slate-400">Per-page confidence</p>
                      <div className="max-h-28 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-[9px] uppercase text-slate-400">
                              <th className="pb-0.5 text-left font-medium">Page</th>
                              <th className="pb-0.5 text-left font-medium">Status</th>
                              <th className="pb-0.5 text-right font-medium">Chars</th>
                            </tr>
                          </thead>
                          <tbody>
                            {file.perPageEntries
                              .filter((p) => p.status !== "GOOD" && p.status !== "TABLE_HEAVY")
                              .slice(0, 30)
                              .map((p) => (
                                <tr key={p.page} className="border-t border-slate-100">
                                  <td className="py-0.5 tabular-nums text-slate-700">{p.page}</td>
                                  <td className={`py-0.5 font-semibold ${p.status === "FAILED" ? "text-red-700" : p.status === "BLANK" ? "text-slate-400" : p.status === "LOW_DENSITY" ? "text-amber-800" : p.status === "OCR" ? "text-blue-700" : "text-slate-500"}`}>
                                    {p.status}
                                  </td>
                                  <td className="py-0.5 text-right tabular-nums text-slate-500">{p.charCount}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <div className="mt-3">
                    {file.totalPages === null || file.totalPages === 0 ? (
                      <p className="text-xs text-slate-400">
                        {file.documentLevelDetection
                          ? "Page count unknown — DOCX/text whole-document detection used"
                          : "Page count unknown"}
                      </p>
                    ) : file.coverage !== null ? (
                      <>
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span>Coverage</span>
                          <span
                            className={`font-semibold ${severityTextClass(scoreToSeverity(file.coverage ?? 0, { good: 95, warn: 50 }))}`}
                          >
                            {file.extractedPages}/{file.totalPages} = {file.coverage}%
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className={`h-full rounded-full transition-all ${(file.coverage ?? 0) >= 95 ? "bg-emerald-500" : (file.coverage ?? 0) >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                            style={{ width: `${Math.min(100, file.coverage)}%` }}
                          />
                        </div>
                      </>
                    ) : null}
                  </div>

                  {(file.submissionPages !== null || file.evaluationPages !== null || file.requiredDocPages !== null || file.clientDetailPages !== null) && (
                    <div className="mt-3 grid grid-cols-4 gap-1.5 text-center text-xs">
                      {[
                        ["Submission", file.submissionPages],
                        ["Eval Criteria", file.evaluationPages],
                        ["Req. Docs", file.requiredDocPages],
                        ["Client Details", file.clientDetailPages],
                      ].map(([label, count]) => (
                        <div key={label as string} className={`rounded-lg border px-1 py-1.5 ${(count as number) > 0 ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
                          <p className="text-[9px] uppercase text-slate-400 leading-tight">{label as string}</p>
                          <p className={`mt-0.5 font-bold ${(count as number) > 0 ? "text-green-700" : "text-red-600"}`}>
                            {sectionCountLabel(count as number, file.documentLevelDetection)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-2 space-y-1">
                    {file.corrupted && (
                      <p className="inline-flex items-start gap-1 text-xs text-red-700">
                        <WarningIcon className="mt-0.5 shrink-0" /> <span>Text appears corrupted — enable OCR or upload a clearer scan</span>
                      </p>
                    )}
                    {!file.corrupted && file.failedPageNums.length > 0 && (
                      <p className="inline-flex items-start gap-1 text-xs text-red-700">
                        <WarningIcon className="mt-0.5 shrink-0" /> <span>{file.failedPageNums.length} page(s) failed extraction — {pageList(file.failedPageNums)}</span>
                      </p>
                    )}
                    {!file.corrupted && file.failedPageNums.length === 0 && file.failedPages !== null && file.failedPages > 0 && (
                      <p className="inline-flex items-start gap-1 text-xs text-red-700">
                        <WarningIcon className="mt-0.5 shrink-0" /> <span>{file.failedPages} page(s) failed extraction</span>
                      </p>
                    )}
                    {!file.corrupted && file.blankPageNums.length > 0 && (
                      <p className="text-xs text-slate-500">
                        Blank pages: {pageList(file.blankPageNums)}
                      </p>
                    )}
                    {!file.corrupted && file.lowDensityPageNums.length > 0 && (
                      <p className="inline-flex items-start gap-1 text-xs text-amber-800">
                        <WarningIcon className="mt-0.5 shrink-0" /> <span>Low-confidence pages ({file.lowDensityPageNums.length}): {pageList(file.lowDensityPageNums)}</span>
                      </p>
                    )}
                    {!file.corrupted && file.tableHeavyPageNums.length > 0 && (
                      <p className="text-xs text-slate-500">
                        Table-heavy pages: {pageList(file.tableHeavyPageNums)}
                      </p>
                    )}
                    {!file.corrupted && file.imageHeavyPageNums.length > 0 && (
                      <p className="text-xs text-slate-500">
                        Image/scan pages: {pageList(file.imageHeavyPageNums)}
                      </p>
                    )}
                    {!file.corrupted &&
                      file.coverage !== null &&
                      file.coverage < 95 && (
                        <p className="inline-flex items-start gap-1 text-xs text-amber-800">
                          <WarningIcon className="mt-0.5 shrink-0" /> <span>Only {file.coverage}% of pages extracted — submission instructions may be missing</span>
                        </p>
                      )}
                    {!file.corrupted && !file.notYetExtracted && file.submissionPages === 0 && file.score >= 45 && (
                      <p className="inline-flex items-start gap-1 text-xs text-amber-800">
                        <WarningIcon className="mt-0.5 shrink-0" /> <span>No submission instructions detected — deadline and submission method may be missing</span>
                      </p>
                    )}
                    {!file.corrupted && !file.notYetExtracted && file.evaluationPages === 0 && file.score >= 45 && (
                      <p className="text-xs text-slate-400 italic">
                        No evaluation criteria detected
                      </p>
                    )}
                    {!file.corrupted && !file.notYetExtracted && file.clientDetailPages === 0 && file.score >= 45 && (
                      <p className="inline-flex items-start gap-1 text-xs text-amber-800">
                        <WarningIcon className="mt-0.5 shrink-0" /> <span>No client/contact detail pages detected — procuring entity name, submission contact, and address may be missing</span>
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <div
          className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
            anyPoor
              ? "border-red-200 bg-red-50 text-red-800"
              : allGood
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          <span className="font-semibold">Recommended action: </span>
          {recommendedAction}
        </div>
      </section>
    );
  } catch {
    return null;
  }
}
