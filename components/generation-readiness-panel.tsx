import Link from "next/link";
import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { getTenderGenerationReadiness, type TenderGenerationReadiness } from "../lib/tender-generation-readiness";

function actionHref(tenderId: string, action?: string): string {
  if (action === "EDIT_TENDER") return `/dashboard/tenders/${tenderId}#legacy-tender-detail-actions`;
  if (action === "EDIT_TENDER_METADATA") return `/dashboard/tenders/${tenderId}#legacy-tender-detail-actions`;
  if (action === "OPEN_COMPANY_READINESS") return "/dashboard/company/readiness";
  if (action === "OPEN_EXTRACTION_QUALITY") return `/dashboard/tenders/${tenderId}#extraction-quality`;
  if (action === "BUILD_SUBMISSION_PLAN") return `/dashboard/tenders/${tenderId}#submission-plan`;
  if (action === "OPEN_ANALYSIS_QUALITY") return `/dashboard/tenders/${tenderId}#analysis-quality`;
  if (action === "OPEN_MATCHING_QUALITY") return `/dashboard/tenders/${tenderId}#matching-quality`;
  if (action === "RUN_ENGINE") return `/dashboard/tenders/${tenderId}#run-engine-action`;
  if (action === "REVIEW_MATCHES") return `/dashboard/tenders/${tenderId}#proposal-evidence-readiness`;
  if (action === "OPEN_KNOWLEDGE_REVIEW") return "/dashboard/company/review-board";
  if (action === "OPEN_COMPLIANCE_REVIEW") return "/dashboard/compliance";
  if (action === "RESOLVE_COMPLIANCE_GAPS") return "/dashboard/compliance";
  if (action === "RUN_ENGINE_OR_APPROVE_ANALYSIS") return `/dashboard/tenders/${tenderId}#run-engine-action`;
  if (action === "RETRY_AI_ANALYZE") return `/dashboard/tenders/${tenderId}#run-engine-action`;
  if (action === "REVIEW_ANALYSIS") return `/dashboard/tenders/${tenderId}#analysis-quality`;
  if (action === "REPAIR_OR_EDIT_TENDER") return `/dashboard/tenders/${tenderId}#legacy-tender-detail-actions`;
  if (action === "OPEN_SETTINGS") return "/dashboard/settings";
  if (action === "OPEN_TENDER_DETAIL") return `/dashboard/tenders/${tenderId}`;
  return `/dashboard/tenders/${tenderId}`;
}

function buildActionLabel(action?: string): string {
  if (action === "EDIT_TENDER") return "Edit client name";
  if (action === "EDIT_TENDER_METADATA") return "Fill missing metadata";
  if (action === "OPEN_COMPANY_READINESS") return "Open company readiness";
  if (action === "OPEN_EXTRACTION_QUALITY") return "Check extraction quality";
  if (action === "BUILD_SUBMISSION_PLAN") return "Build submission plan";
  if (action === "OPEN_ANALYSIS_QUALITY") return "Open analysis quality";
  if (action === "OPEN_MATCHING_QUALITY") return "Open matching quality";
  if (action === "RUN_ENGINE") return "Run engine";
  if (action === "REVIEW_MATCHES") return "Review matches";
  if (action === "OPEN_KNOWLEDGE_REVIEW") return "Open review board";
  if (action === "OPEN_COMPLIANCE_REVIEW" || action === "RESOLVE_COMPLIANCE_GAPS") return "Open compliance";
  if (action === "RUN_ENGINE_OR_APPROVE_ANALYSIS") return "Retry AI Analyze or approve fallback";
  if (action === "RETRY_AI_ANALYZE") return "Retry AI Analyze";
  if (action === "REVIEW_ANALYSIS") return "Review analysis quality";
  if (action === "REPAIR_OR_EDIT_TENDER") return "Repair or edit metadata";
  if (action === "OPEN_SETTINGS") return "Open settings";
  if (action === "OPEN_TENDER_DETAIL") return "Open tender detail";
  return "Open tender";
}

function ScoreGauge({ score }: { score: number }) {
  // Clamp score to [0, 100]
  const s = Math.max(0, Math.min(100, score));

  // Determine color tier
  let colorClass: string;
  let labelText: string;
  if (s >= 90) {
    colorClass = "bg-emerald-500";
    labelText = "FULLY READY";
  } else if (s >= 70) {
    colorClass = "bg-green-500";
    labelText = "READY";
  } else if (s >= 40) {
    colorClass = "bg-amber-500";
    labelText = "PARTIAL";
  } else {
    colorClass = "bg-red-500";
    labelText = "NOT READY";
  }

  const textColor = s >= 90 ? "text-emerald-700" : s >= 70 ? "text-green-700" : s >= 40 ? "text-amber-700" : "text-red-700";

  return (
    <div className="flex flex-col items-center gap-1 min-w-[96px]">
      <div className="relative w-24 h-3 rounded-full bg-slate-200 overflow-hidden">
        <div
          className={`absolute left-0 top-0 h-full rounded-full transition-all duration-300 ${colorClass}`}
          style={{ width: `${s}%` }}
        />
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-2xl font-extrabold leading-none ${textColor}`}>{s}</span>
        <span className="text-xs text-slate-400 font-medium">/100</span>
      </div>
      <span className={`text-[10px] font-bold uppercase tracking-wide ${textColor}`}>{labelText}</span>
    </div>
  );
}

export async function GenerationReadinessPanel({
  tenderId,
  readiness: providedReadiness,
}: {
  tenderId: string;
  readiness?: TenderGenerationReadiness | null;
}) {
  const userId = await getSession();
  if (!userId) return null;

  try {
  const readiness = providedReadiness ?? await (async () => {
    await prismaReady;
    return getTenderGenerationReadiness(prisma, userId, tenderId);
  })();
  if (!readiness) return null;

  const { ready, blockers, fullProposalBlockers, warnings, score } = readiness;
  // Use fullProposalReady for the headline label — it is the stricter gate.
  // ready / supportPackageReady only covers blockers; fullProposalReady also
  // covers fullProposalBlockers (e.g. missing client details, weak extraction).
  const fullProposalReady = readiness.fullProposalReady ?? ready;
  const isFullyReady = fullProposalReady;

  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${isFullyReady ? "border-green-200 bg-green-50" : ready ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide ${isFullyReady ? "text-green-700" : ready ? "text-amber-700" : "text-red-700"}`}>Generation readiness</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">{isFullyReady ? "Ready to generate full proposal" : "Generation blockers found"}</h2>
          <p className="mt-1 text-sm text-slate-600">Preflight check for company knowledge, tender analysis, matching quality, compliance blockers, client metadata, and selected reviewed evidence.</p>
          {ready && !fullProposalReady && (
            <p className="mt-1 text-sm text-amber-700">
              Support packages may generate, but full proposal is blocked. Resolve blockers below.
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <ScoreGauge score={score} />
          <Link href={`/api/tenders/${tenderId}/generation-readiness`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
            Open JSON
          </Link>
        </div>
      </div>

      {blockers.length > 0 && (
        <div className="mt-4 space-y-2">
          {blockers.map((item, index) => (
            <div key={`${item.code}-${index}`} className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm text-red-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{item.message}</span>
                <Link href={actionHref(tenderId, item.nextAction)} className="text-xs font-semibold text-red-700 underline">{buildActionLabel(item.nextAction)}</Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {fullProposalBlockers && fullProposalBlockers.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Full proposal blockers</p>
          {fullProposalBlockers.map((item, index) => (
            <div key={`fp-${item.code}-${index}`} className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-amber-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{item.message}</span>
                <Link href={actionHref(tenderId, item.nextAction)} className="text-xs font-semibold text-amber-700 underline">{buildActionLabel(item.nextAction)}</Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mt-4 space-y-2">
          {warnings.slice(0, 5).map((item, index) => (
            <div key={`${item.code}-${index}`} className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-amber-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{item.message}</span>
                <Link href={actionHref(tenderId, item.nextAction)} className="text-xs font-semibold text-amber-700 underline">{buildActionLabel(item.nextAction)}</Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
  } catch (err) {
    console.error("[GenerationReadinessPanel] render error:", err);
    return (
      <section className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
        <p className="text-xs font-semibold text-amber-700">Panel failed to load — data may be incomplete. Refresh to retry.</p>
      </section>
    );
  }
}
