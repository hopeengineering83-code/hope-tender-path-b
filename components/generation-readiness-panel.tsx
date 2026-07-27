import Link from "next/link";
import { FinalizeRequiredPdfButton } from "./finalize-required-pdf-button";
import { canMutateTender } from "../lib/recovery-command-actions";
import { getCurrentUser } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { getTenderGenerationReadinessStrict } from "../lib/tender-generation-readiness-strict";
import type { TenderGenerationReadiness } from "../lib/tender-generation-readiness";
import { clientLogger } from "@/lib/ui/client-logger";

function dedupeReadinessItems<T extends { code?: string; message: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.code ?? ""}|${item.message.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function actionHref(tenderId: string, action?: string): string {
  if (action === "EDIT_TENDER") return `/dashboard/tenders/${tenderId}#tender-edit-form`;
  if (action === "EDIT_TENDER_METADATA") return `/dashboard/tenders/${tenderId}#tender-edit-form`;
  if (action === "OPEN_COMPANY_READINESS") return "/dashboard/company/readiness";
  if (action === "OPEN_EXTRACTION_QUALITY") return `/dashboard/tenders/${tenderId}#extraction-quality`;
  if (action === "BUILD_SUBMISSION_PLAN") return `/dashboard/tenders/${tenderId}#submission-plan-reconciliation`;
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
  if (action === "REPAIR_OR_EDIT_TENDER") return `/dashboard/tenders/${tenderId}#tender-edit-form`;
  if (action === "OPEN_SETTINGS") return "/dashboard/settings";
  if (action === "OPEN_TENDER_DETAIL") return `/dashboard/tenders/${tenderId}`;
  if (action === "FINALIZE_REQUIRED_PDF") return `/dashboard/tenders/${tenderId}#generated-documents`;
  return `/dashboard/tenders/${tenderId}`;
}

function buildActionLabel(action?: string): string {
  if (action === "EDIT_TENDER") return "Edit client name";
  if (action === "EDIT_TENDER_METADATA") return "Fill missing Tender Details";
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
  if (action === "REPAIR_OR_EDIT_TENDER") return "Repair or edit Tender Details";
  if (action === "OPEN_SETTINGS") return "Open settings";
  if (action === "OPEN_TENDER_DETAIL") return "Open tender detail";
  if (action === "FINALIZE_REQUIRED_PDF") return "Finalize required PDF";
  return "Open tender";
}

function ScoreGauge({ score }: { score: number }) {
  const value = Math.max(0, Math.min(100, score));
  return (
    <div className="flex min-w-[96px] flex-col items-center gap-1" title="Secondary readiness score. It never overrides blockers or the server generation gate.">
      <div className="relative h-3 w-24 overflow-hidden rounded-full bg-slate-200">
        <div className="absolute left-0 top-0 h-full rounded-full bg-slate-500 transition-all duration-300" style={{ width: `${value}%` }} />
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-extrabold leading-none text-slate-800">{value}</span>
        <span className="text-xs font-medium text-slate-400">/100</span>
      </div>
      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Secondary score</span>
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
  const user = await getCurrentUser();
  if (!user) return null;
  const userId = user.id;
  // Mutation controls (Execute buttons) are HIDDEN for roles that cannot
  // mutate tenders — REVIEWER/VIEWER only ever see read-only links.
  const canMutate = canMutateTender(user.role);

  try {
    const readiness = providedReadiness === undefined
      ? await (async () => {
          await prismaReady;
          return getTenderGenerationReadinessStrict(prisma, userId, tenderId);
        })()
      : providedReadiness;

    if (!readiness) {
      return (
        <section className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Generation readiness unavailable</p>
          <p className="mt-1 text-sm text-red-800">Generation readiness is loading. Refresh to retry.</p>
          <Link href={`/api/tenders/${tenderId}/generation-readiness`} className="mt-2 inline-block text-xs font-semibold text-red-700 underline">Open diagnostic endpoint</Link>
        </section>
      );
    }

    const { score } = readiness;
    const blockers = dedupeReadinessItems(readiness.blockers);
    const blockerKeys = new Set(blockers.map((item) => `${item.code ?? ""}|${item.message.trim().toLowerCase()}`));
    const fullProposalBlockers = dedupeReadinessItems(readiness.fullProposalBlockers ?? [])
      .filter((item) => !blockerKeys.has(`${item.code ?? ""}|${item.message.trim().toLowerCase()}`));
    const warnings = dedupeReadinessItems(readiness.warnings);
    const fullProposalReady = Boolean(readiness.fullProposalReady);
    const supportPackageReady = Boolean(readiness.supportPackageReady);
    // If there are full-proposal blockers, the proposal is NOT ready regardless
    // of what fullProposalReady says — the canonical gate (consumed by the
    // Generation Action panel) is authoritative. This prevents the contradiction
    // where this panel says "Ready" while the action panel says "not ready".
    const hasFullProposalBlockers = (fullProposalBlockers ?? []).length > 0;
    // Also check for no confirmed build plan — without it, generation cannot
    // proceed safely. The readiness API includes this in blockers, but we
    // double-check here to ensure the UI never shows "Ready" without a plan.
    const hasNoConfirmedPlan = blockers.some((b: { code?: string }) =>
      b.code === "BUILD_PLAN_MISSING" || b.code === "BUILD_PLAN_STALE" ||
      b.code === "BUILD_PLAN_NOT_CONFIRMED" || b.code === "BUILD_PLAN_ITEMS_INVALID"
    );
    // Also check for stale analysis and missing compliance rows — these are
    // canonical snapshot blockers that the strict gate may not catch.
    // Per spec: Generation Readiness must not show "Ready" when the
    // authoritative snapshot is blocked by stale AI, no compliance rows,
    // or PDF required but unavailable.
    const hasStaleAnalysis = blockers.some((b: { code?: string }) =>
      b.code === "STALE_ANALYSIS" || b.code === "ANALYSIS_HASH_MISMATCH"
    );
    const hasNoComplianceRows = blockers.some((b: { code?: string }) =>
      b.code === "MANDATORY_NO_COMPLIANCE_ROWS" || b.code === "EVIDENCE_NOT_ASSESSED"
    );
    const hasPdfRequiredUnavailable = blockers.some((b: { code?: string }) =>
      b.code === "PDF_REQUIRED_CONVERSION_UNAVAILABLE" || b.code === "PDF_CONVERSION_REQUIRED"
    );
    const effectivelyReady = fullProposalReady && !hasFullProposalBlockers && !hasNoConfirmedPlan
      && !hasStaleAnalysis && !hasNoComplianceRows && !hasPdfRequiredUnavailable;
    const panelClass = effectivelyReady
      ? "border-green-200 bg-green-50"
      : "border-red-200 bg-red-50";
    const statusClass = effectivelyReady ? "text-green-700" : "text-red-700";

    return (
      <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${panelClass}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className={`text-xs font-semibold uppercase tracking-wide ${statusClass}`}>Generation readiness</p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">{effectivelyReady ? "Ready to generate full proposal" : "Full proposal generation blocked"}</h2>
            <p className="mt-1 text-sm text-slate-600">The server gate is authoritative. The numeric score is informational and cannot override blockers.</p>
            {hasNoConfirmedPlan && (
              <p className="mt-1 text-sm text-red-700 font-medium">No confirmed Build Plan. Build and confirm the submission plan before generating.</p>
            )}
            {supportPackageReady && !effectivelyReady && (
              <p className="mt-1 text-sm text-amber-800">Support packages may be generated, but the full proposal remains blocked.</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* When blockers exist, visually de-emphasize the score — it's misleading to show a high score next to "blocked" */}
            <ScoreGauge score={effectivelyReady ? score : Math.min(score, 45)} />
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
            <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Full proposal blockers</p>
            {fullProposalBlockers.map((item, index) => (
              <div key={`fp-${item.code}-${index}`} className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm text-red-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{item.message}</span>
                  <Link href={actionHref(tenderId, item.nextAction)} className="text-xs font-semibold text-red-700 underline">{buildActionLabel(item.nextAction)}</Link>
                </div>
              </div>
            ))}
          </div>
        )}

        {(() => {
          // Deduplicate: suppress warnings whose message already appears in
          // blockers or fullProposalBlockers — showing the same text twice
          // (once as red blocker, once as amber warning) is confusing.
          const blockerMessages = new Set<string>();
          for (const b of blockers) blockerMessages.add(b.message);
          if (fullProposalBlockers) for (const b of fullProposalBlockers) blockerMessages.add(b.message);
          const dedupedWarnings = warnings.filter((w: { message: string }) => !blockerMessages.has(w.message));
          if (dedupedWarnings.length === 0) return null;
          return (
          <div className="mt-4 space-y-2">
            {dedupedWarnings.slice(0, 5).map((item, index) => (
              <div key={`${item.code}-${index}`} className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-amber-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{item.message}</span>
                  <span className="inline-flex items-center gap-2">
                    {canMutate && item.nextAction === "FINALIZE_REQUIRED_PDF"
                      ? <FinalizeRequiredPdfButton tenderId={tenderId} />
                      : <Link href={actionHref(tenderId, item.nextAction)} className="text-xs font-semibold text-amber-800 underline">{buildActionLabel(item.nextAction)}</Link>}
                  </span>
                </div>
              </div>
            ))}
          </div>
          );
        })()}
      </section>
    );
  } catch (error) {
    clientLogger.error("[GenerationReadinessPanel] render error", {
      tenderId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    });
    return (
      <section className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm">
        <p className="text-xs font-semibold text-red-700">Generation readiness failed to load. Generation remains blocked. Refresh to retry.</p>
      </section>
    );
  }
}
