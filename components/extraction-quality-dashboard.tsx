import { prisma, prismaReady } from "../lib/prisma";
import { assessExtractionQuality, assessExtractionQualityPerPage } from "../lib/extraction-quality";
import { isExtractionCorrupted } from "../lib/engine/extraction-quality-gate";

type FileStatus = "GOOD" | "ACCEPTABLE" | "POOR";

function getStatus(score: number): FileStatus {
  if (score >= 75) return "GOOD";
  if (score >= 45) return "ACCEPTABLE";
  return "POOR";
}

function statusPill(status: FileStatus) {
  const classes =
    status === "GOOD"
      ? "bg-green-100 text-green-700"
      : status === "ACCEPTABLE"
        ? "bg-amber-100 text-amber-700"
        : "bg-red-100 text-red-700";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${classes}`}>
      {status}
    </span>
  );
}

function scoreBadge(score: number, status: FileStatus) {
  const classes =
    status === "GOOD"
      ? "bg-green-100 text-green-800"
      : status === "ACCEPTABLE"
        ? "bg-amber-100 text-amber-800"
        : "bg-red-100 text-red-800";
  return (
    <span className={`rounded-lg px-2 py-1 text-xs font-bold tabular-nums ${classes}`}>
      {Math.round(score)}/100
    </span>
  );
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
      },
      orderBy: { createdAt: "asc" },
    });

    if (files.length === 0) {
      return (
        <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <span>📄</span>
            <h2 className="text-base font-semibold text-slate-700">Extraction Quality</h2>
          </div>
          <p className="mt-2 text-sm text-slate-500">No files uploaded yet.</p>
        </section>
      );
    }

    const fileData = files.map((file) => {
      const name = file.originalFileName || file.fileName;
      const text = file.extractedText ?? null;
      // Check corruption on first 200 chars only — avoid loading entire text blob
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

      // Derive a human-friendly file type from mimeType or file extension
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

      return {
        id: file.id,
        name,
        fileType,
        totalPages,
        extractedPages,
        ocrPages,
        failedPages,
        coverage,
        corrupted,
        score,
        status,
        quality,
        notYetExtracted,
        submissionPages: perPage?.submissionInstructionPages.length ?? null,
        evaluationPages: perPage?.evaluationCriteriaPages.length ?? null,
        requiredDocPages: perPage?.requiredDocumentPages.length ?? null,
        clientDetailPages: perPage?.clientDetailPages.length ?? null,
      };
    });

    const anyPoor = fileData.some((f) => f.status === "POOR" || f.corrupted);
    const allGood = fileData.every((f) => f.status === "GOOD" && !f.corrupted);

    const headerBadge = anyPoor ? (
      <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">
        Action Required
      </span>
    ) : allGood ? (
      <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">
        All Clear
      </span>
    ) : (
      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
        Review Recommended
      </span>
    );

    // Determine overall recommended action
    let recommendedAction: string;
    if (fileData.some((f) => f.corrupted)) {
      recommendedAction =
        "Enable OCR or upload a clearer scan before running AI Analyze";
    } else if (fileData.some((f) => f.score < 45)) {
      recommendedAction = "Re-extract or upload a higher-quality PDF";
    } else if (fileData.some((f) => f.score < 75)) {
      recommendedAction = "Review extraction quality before generating documents";
    } else {
      recommendedAction =
        "Extraction quality is acceptable. Proceed with AI Analyze.";
    }

    return (
      <section className="mb-4 rounded-2xl border bg-white p-5 shadow-sm">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">📄</span>
            <div>
              <h2 className="text-base font-bold text-slate-900">Extraction Quality</h2>
              <p className="text-xs text-slate-500">
                Per-file breakdown of page extraction coverage and quality
              </p>
            </div>
          </div>
          {headerBadge}
        </div>

        {/* Per-file cards */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {fileData.map((file) => (
            <div
              key={file.id}
              className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm"
            >
              {/* File name + type + status */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{file.name}</p>
                  <div className="mt-0.5 flex items-center gap-2">
                    {file.fileType && (
                      <span className="text-xs uppercase text-slate-400">{file.fileType}</span>
                    )}
                    {statusPill(file.status)}
                  </div>
                </div>
                <div className="flex-shrink-0">{scoreBadge(file.score, file.status)}</div>
              </div>

              {/* Not yet extracted notice */}
              {file.notYetExtracted ? (
                <p className="mt-3 text-xs italic text-slate-500">Not yet extracted</p>
              ) : (
                <>
                  {/* Pages grid */}
                  <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                    {(
                      [
                        ["Total", file.totalPages],
                        ["Extracted", file.extractedPages],
                        ["OCR", file.ocrPages],
                        ["Failed/Weak", file.failedPages],
                      ] as [string, number | null][]
                    ).map(([label, value]) => (
                      <div key={label} className="rounded-lg border bg-white px-2 py-2">
                        <p className="text-[10px] uppercase text-slate-400">{label}</p>
                        <p className="mt-0.5 text-base font-bold text-slate-800">
                          {value !== null ? (
                            value
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Coverage */}
                  <div className="mt-3">
                    {file.totalPages === null || file.totalPages === 0 ? (
                      <p className="text-xs text-slate-400">Page count unknown</p>
                    ) : file.coverage !== null ? (
                      <>
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span>Coverage</span>
                          <span
                            className={`font-semibold ${
                              file.coverage >= 80
                                ? "text-green-700"
                                : file.coverage >= 50
                                  ? "text-amber-700"
                                  : "text-red-700"
                            }`}
                          >
                            {file.extractedPages}/{file.totalPages} = {file.coverage}%
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className={`h-full rounded-full transition-all ${
                              file.coverage >= 80
                                ? "bg-green-500"
                                : file.coverage >= 50
                                  ? "bg-amber-500"
                                  : "bg-red-500"
                            }`}
                            style={{ width: `${Math.min(100, file.coverage)}%` }}
                          />
                        </div>
                      </>
                    ) : null}
                  </div>

                  {/* Content page detection */}
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
                            {(count as number) > 0 ? `${count}p` : "0"}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Inline warnings */}
                  <div className="mt-2 space-y-1">
                    {file.corrupted && (
                      <p className="text-xs text-red-700">
                        ⚠ Text appears corrupted — enable OCR or upload a clearer scan
                      </p>
                    )}
                    {!file.corrupted &&
                      file.failedPages !== null &&
                      file.failedPages > 0 && (
                        <p className="text-xs text-red-700">
                          ⚠ {file.failedPages} page(s) failed extraction
                        </p>
                      )}
                    {!file.corrupted &&
                      file.coverage !== null &&
                      file.coverage < 80 && (
                        <p className="text-xs text-amber-700">
                          ⚠ Only {file.coverage}% of pages extracted — submission
                          instructions may be missing
                        </p>
                      )}
                    {!file.corrupted && !file.notYetExtracted && file.submissionPages === 0 && file.score >= 45 && (
                      <p className="text-xs text-amber-700">
                        ⚠ No submission instruction pages detected — deadline and submission method may be missing
                      </p>
                    )}
                    {!file.corrupted && !file.notYetExtracted && file.evaluationPages === 0 && file.score >= 45 && (
                      <p className="text-xs text-slate-400 italic">
                        No evaluation criteria pages detected
                      </p>
                    )}
                    {!file.corrupted && !file.notYetExtracted && file.clientDetailPages === 0 && file.score >= 45 && (
                      <p className="text-xs text-amber-700">
                        ⚠ No client/contact detail pages detected — procuring entity name, submission contact, and address may be missing
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Recommended action banner */}
        <div
          className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
            anyPoor
              ? "border-red-200 bg-red-50 text-red-800"
              : allGood
                ? "border-green-200 bg-green-50 text-green-800"
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
