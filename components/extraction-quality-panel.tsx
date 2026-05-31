import Link from "next/link";
import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { assessExtractionQuality } from "../lib/extraction-quality";

export async function ExtractionQualityPanel({ tenderId }: { tenderId: string }) {
  const userId = await getSession();
  if (!userId) return null;

  await prismaReady;
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: { files: { orderBy: { createdAt: "asc" } } },
  });
  if (!tender || tender.files.length === 0) return null;

  const reports = tender.files.map((file) => ({
    id: file.id,
    fileName: file.originalFileName || file.fileName,
    quality: assessExtractionQuality(file.extractedText, file.originalFileName || file.fileName),
  }));
  const blockers = reports.filter((item) => item.quality.severity === "FAILED" || item.quality.severity === "POOR");
  const warnings = reports.filter((item) => item.quality.severity === "WARNING");
  const ready = blockers.length === 0;

  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${ready ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide ${ready ? "text-green-700" : "text-red-700"}`}>Extraction quality</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">{ready ? "Extracted text appears usable" : "Extraction quality blockers found"}</h2>
          <p className="mt-1 text-sm text-slate-600">Preflight check for scanned PDFs, failed extraction, low text density, legacy DOC files, and table-heavy tender documents.</p>
        </div>
        <div className="flex items-center gap-2">
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

      {(blockers.length > 0 || warnings.length > 0) && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {[...blockers, ...warnings].slice(0, 6).map((item) => (
            <div key={item.id} className="rounded-xl border bg-white p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-slate-900">{item.fileName}</p>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${item.quality.severity === "GOOD" ? "bg-green-100 text-green-700" : item.quality.severity === "WARNING" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                  {item.quality.severity} · {item.quality.score}/100
                </span>
              </div>
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
