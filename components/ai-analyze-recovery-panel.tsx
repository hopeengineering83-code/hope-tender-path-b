// AI Analyze Recovery Panel — server component.
//
// Shows when AI Analyze has not run, used regex fallback, or was blocked
// by extraction issues. Explains the current analysisExtractionStatus and
// provides actionable recovery steps. Hidden when analysis is clean.

import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";

const STATUS_LABELS: Record<string, { title: string; detail: string; risk: "HIGH" | "MEDIUM" | "OK" }> = {
  FULL_EXTRACTION_AI_ANALYZED: {
    title: "Full extraction — AI analyzed",
    detail: "All tender pages were extracted and AI analysis completed successfully.",
    risk: "OK",
  },
  PARTIAL_EXTRACTION_AI_ANALYZED: {
    title: "Partial extraction — AI analyzed",
    detail: "Some tender pages were not fully extracted. AI analysis ran on the available text. Check extraction quality and re-run AI Analyze if important sections are missing.",
    risk: "MEDIUM",
  },
  OCR_REQUIRED: {
    title: "OCR required",
    detail: "The tender file contains scanned/image pages that could not be text-extracted. AI analysis may be incomplete. Re-upload with OCR enabled or use a text-searchable PDF.",
    risk: "HIGH",
  },
  EXTRACTION_WEAK_REVIEW_REQUIRED: {
    title: "Weak extraction — review required",
    detail: "Extraction quality was below threshold. AI analysis ran but may have missed requirements, evaluation criteria, or submission instructions. Review extracted data carefully.",
    risk: "HIGH",
  },
  EXTRACTION_CORRUPTED_AI_SKIPPED: {
    title: "Corrupted extraction — AI skipped",
    detail: "Extracted text contained corruption markers. AI Analyze was skipped to avoid producing a confidently wrong result. Fix extraction before re-running.",
    risk: "HIGH",
  },
  REGEX_FALLBACK_FROM_WEAK_EXTRACTION: {
    title: "Regex fallback (weak extraction)",
    detail: "AI providers were unavailable or failed, and extraction quality was too weak for reliable regex parsing. Results are unreliable — re-run after fixing extraction and provider health.",
    risk: "HIGH",
  },
};

const RECOVERY_STEPS: Record<string, string[]> = {
  OCR_REQUIRED: [
    "Re-upload the tender file with OCR extraction enabled.",
    "Alternatively, convert the scanned PDF to a text-searchable PDF using an OCR tool before uploading.",
    "Once extraction quality improves, re-run AI Analyze from the Engine Action panel.",
  ],
  EXTRACTION_WEAK_REVIEW_REQUIRED: [
    "Check the Extraction Quality panel — identify which pages failed or have low confidence.",
    "Upload a cleaner scan or higher-resolution PDF if available.",
    "Re-run AI Analyze after improving extraction. If extraction cannot be improved, manually confirm metadata, requirements, and submission rules.",
  ],
  EXTRACTION_CORRUPTED_AI_SKIPPED: [
    "The extracted text is corrupted — likely a scanned PDF with failed OCR.",
    "Upload a text-searchable PDF or enable OCR in the extraction settings.",
    "Once extraction is clean, re-run AI Analyze from the Engine Action panel.",
  ],
  REGEX_FALLBACK_FROM_WEAK_EXTRACTION: [
    "Check the AI Health panel — verify at least one AI provider (Gemini, OpenAI, Mistral) is configured and healthy.",
    "Fix extraction quality first (see Extraction Quality panel).",
    "Then re-run AI Analyze from the Engine Action panel.",
  ],
  PARTIAL_EXTRACTION_AI_ANALYZED: [
    "Check the Extraction Quality panel to see which pages were weak or missing.",
    "If evaluation criteria, submission instructions, or required forms pages are missing — re-upload with a better quality PDF.",
    "Re-run AI Analyze to update requirements and submission rules after re-extraction.",
  ],
};

export async function AIAnalyzeRecoveryPanel({ tenderId }: { tenderId: string }) {
  const userId = await getSession();
  if (!userId) return null;

  try {
  await prismaReady;

  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    select: {
      analysisSummary: true,
      analysisExtractionStatus: true,
    },
  }).catch(() => null);

  if (!tender) return null;

  const status = tender.analysisExtractionStatus ?? null;
  const hasRun = Boolean(tender.analysisSummary);

  const isProblem = !hasRun ||
    status === "OCR_REQUIRED" ||
    status === "EXTRACTION_CORRUPTED_AI_SKIPPED" ||
    status === "EXTRACTION_WEAK_REVIEW_REQUIRED" ||
    status === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION" ||
    status === "PARTIAL_EXTRACTION_AI_ANALYZED";

  if (!isProblem) return null;

  const info = status ? STATUS_LABELS[status] : null;
  const steps = status ? RECOVERY_STEPS[status] : null;
  const risk = info?.risk ?? (hasRun ? "MEDIUM" : "HIGH");

  const bgClass = risk === "HIGH" ? "border-red-200 bg-red-50" : risk === "MEDIUM" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50";
  const titleClass = risk === "HIGH" ? "text-red-700" : risk === "MEDIUM" ? "text-amber-700" : "text-slate-600";
  const badgeClass = risk === "HIGH" ? "bg-red-100 text-red-700" : risk === "MEDIUM" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600";

  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${bgClass}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${titleClass}`}>AI Analyze — recovery</p>
      <h2 className="mt-1 text-lg font-bold text-slate-900">
        {!hasRun ? "AI Analyze has not been run" : (info?.title ?? `Status: ${status}`)}
      </h2>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {status && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}>{status}</span>
        )}
        {!hasRun && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">NOT RUN</span>
        )}
      </div>

      <p className="mt-2 text-sm text-slate-700">
        {!hasRun
          ? "No AI analysis has been performed on this tender. Run AI Analyze from the Engine Action panel to extract requirements, client details, and submission instructions."
          : (info?.detail ?? "Analysis status requires manual review.")}
      </p>

      {steps && steps.length > 0 && (
        <div className="mt-3 rounded-lg border border-white/70 bg-white px-4 py-3">
          <p className="text-xs font-semibold text-slate-700 mb-1">Recovery steps</p>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-700">
            {steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
        </div>
      )}

      {!hasRun && (
        <div className="mt-3 rounded-lg border border-white/70 bg-white px-4 py-3">
          <p className="text-xs font-semibold text-slate-700 mb-1">How to run AI Analyze</p>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-700">
            <li>Upload the tender file if not already done (see Extraction Quality panel).</li>
            <li>Click <strong>Run Engine</strong> in the Engine Action panel above.</li>
            <li>Wait for the analysis job to complete — the page will refresh with extracted data.</li>
          </ol>
        </div>
      )}
    </section>
  );
  } catch (err) {
    console.error("[AIAnalyzeRecoveryPanel] render error:", err);
    return (
      <section className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
        <p className="text-xs font-semibold text-amber-700">Panel failed to load — data may be incomplete. Refresh to retry.</p>
      </section>
    );
  }
}
