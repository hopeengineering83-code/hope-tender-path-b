import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { safeParseJsonObject } from "../lib/safe-json";
import { clientLogger } from "@/lib/ui/client-logger";

const PROBLEM_STATES = new Set([
  "OCR_REQUIRED",
  "EXTRACTION_CORRUPTED_AI_SKIPPED",
  "EXTRACTION_WEAK_REVIEW_REQUIRED",
  "REGEX_FALLBACK_FROM_WEAK_EXTRACTION",
  "PARTIAL_EXTRACTION_AI_ANALYZED",
]);

function stagedView(raw: string | null) {
  if (!raw) return null;
  const parsed = safeParseJsonObject(raw);
  if (!parsed) return null;
  if (parsed.analysisSource !== "PARTIAL_AI" && parsed.analysisSource !== "FALLBACK_DRAFT") return null;
  if (typeof parsed.summary !== "string" || !Array.isArray(parsed.requirements)) return null;
  return {
    source: parsed.analysisSource,
    summary: parsed.summary,
    requirementCount: parsed.requirements.length,
    completedChunks: typeof parsed.completedChunks === "number" ? parsed.completedChunks : null,
    totalChunks: typeof parsed.totalChunks === "number" ? parsed.totalChunks : null,
  };
}

export async function AIAnalyzeRecoveryPanel({ tenderId }: { tenderId: string }) {
  const userId = await getSession();
  if (!userId) return null;

  try {
    await prismaReady;
    let tender: { analysisSummary: string | null; analysisExtractionStatus: string | null } | null = null;
    let job: { id: string; status: string; stagedMergedResult: string | null } | null = null;
    try {
      [tender, job] = await Promise.all([
        prisma.tender.findFirst({
          where: { id: tenderId, userId },
          select: { analysisSummary: true, analysisExtractionStatus: true },
        }),
        prisma.aiJob.findFirst({
          where: { tenderId, userId, jobType: "AI_ANALYZE" as const, stagedMergedResult: { not: null }, promotedAt: null },
          orderBy: [{ analysisVersion: "desc" }, { createdAt: "desc" }],
          select: { id: true, status: true, stagedMergedResult: true },
        }),
      ]);
    } catch {
      // Sanitized — never expose raw Prisma errors to the UI.
      return null;
    }
    if (!tender) return null;

    const staged = stagedView(job?.stagedMergedResult != null ? String(job.stagedMergedResult) : null);
    const status = tender.analysisExtractionStatus;
    const hasCanonical = Boolean(tender.analysisSummary);
    if (!staged && hasCanonical && (!status || !PROBLEM_STATES.has(status))) return null;

    const highRisk = Boolean(staged?.source === "FALLBACK_DRAFT") || status === "OCR_REQUIRED" || status === "EXTRACTION_CORRUPTED_AI_SKIPPED" || status === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION";
    const shell = highRisk ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50";
    const text = highRisk ? "text-red-700" : "text-amber-800";

    return (
      <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${shell}`}>
        <p className={`text-xs font-semibold uppercase tracking-wide ${text}`}>AI Analyze — recovery</p>
        <h2 className="mt-1 text-lg font-bold text-slate-900">
          {staged ? staged.source === "FALLBACK_DRAFT" ? "Fallback draft awaiting review" : "Partial AI analysis awaiting completion" : !hasCanonical ? "AI Analyze has not been run" : "Analysis requires recovery"}
        </h2>
        <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium">
          {status && <span className="rounded-full bg-white px-2 py-1">{status}</span>}
          {staged && <span className="rounded-full bg-white px-2 py-1">{staged.source}</span>}
        </div>
        {staged ? (
          <div className="mt-3 rounded-xl border border-white bg-white p-3 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">This staged result is not canonical and cannot enable generation or export.</p>
            <p className="mt-1">{staged.requirementCount} requirement(s){staged.totalChunks !== null ? ` · ${staged.completedChunks ?? 0}/${staged.totalChunks} chunks` : ""}</p>
            <p className="mt-2 whitespace-pre-wrap text-xs text-slate-600">{staged.summary.slice(0, 1000)}</p>
            <p className="mt-2 text-xs">{staged.source === "FALLBACK_DRAFT" ? "Re-run with a healthy provider or explicitly review the fallback. Trusted analysis remains unchanged." : "Resume AI Analyze to complete the missing chunks. Trusted analysis remains unchanged."}</p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-700">Check extraction quality and provider health, then run or resume AI Analyze. Do not generate final documents while this state remains unresolved.</p>
        )}
      </section>
    );
  } catch (error) {
    clientLogger.error("[AIAnalyzeRecoveryPanel] render error", {
      tenderId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      message: "AI recovery state check failed (internal error).", // sanitized — never expose raw Prisma errors
    });
    return <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">AI recovery state is loading. Refresh to retry.</section>;
  }
}
