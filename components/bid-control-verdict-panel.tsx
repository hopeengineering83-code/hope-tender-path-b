import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { getTenderGenerationReadiness } from "../lib/tender-generation-readiness";
import { getFinalSubmissionReadiness } from "../lib/engine/final-submission-readiness";
import { BidDecisionForm } from "./bid-decision-form";

type Verdict = "BID_READY" | "BID_READY_WITH_WARNINGS" | "NOT_READY" | "NO_BID";

function verdictLabel(verdict: Verdict) {
  if (verdict === "BID_READY") return "BID READY";
  if (verdict === "BID_READY_WITH_WARNINGS") return "BID READY WITH WARNINGS";
  if (verdict === "NO_BID") return "NO BID";
  return "NOT READY";
}

function verdictClass(verdict: Verdict) {
  if (verdict === "BID_READY") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (verdict === "BID_READY_WITH_WARNINGS") return "border-amber-200 bg-amber-50 text-amber-800";
  if (verdict === "NO_BID") return "border-slate-300 bg-slate-100 text-slate-700";
  return "border-red-200 bg-red-50 text-red-800";
}

function statusText(value?: string | null) {
  return (value ?? "UNKNOWN").replace(/_/g, " ");
}

export async function BidControlVerdictPanel({ tenderId }: { tenderId: string }) {
  const userId = await getSession();
  if (!userId) return null;
  await prismaReady;

  // Canonical readiness — same shape consumed by Export Gate, Final
  // Submission Control Center, and download ZIP route. Bid Control
  // intentionally NEVER reconstructs the blocker logic locally; it
  // reads the canonical answer so the same tender cannot show
  // inconsistent counts across panels.
  const [generationReadiness, canonical, tender] = await Promise.all([
    getTenderGenerationReadiness(prisma, userId, tenderId),
    getFinalSubmissionReadiness(prisma, { tenderId, userId, requireFileContent: false }),
    prisma.tender.findFirst({
      where: { id: tenderId, userId },
      select: {
        id: true,
        title: true,
        status: true,
        complianceGaps: { where: { isResolved: false, severity: { in: ["CRITICAL", "HIGH"] } }, select: { id: true, severity: true } },
      },
    }),
  ]);

  if (!tender || !generationReadiness || !canonical) return null;

  const fullProposalReady = generationReadiness.fullProposalReady ?? generationReadiness.ready;
  const supportPackageReady = generationReadiness.supportPackageReady ?? generationReadiness.ready;
  const fullProposalBlockers = generationReadiness.fullProposalBlockers ?? [];

  // Final readiness counts come ONLY from the canonical helper — Bid
  // Control no longer counts ungenerated/unvalidated/unreviewed docs
  // separately, because canonical.summary.documentBlockers already
  // covers every per-doc reason (and excludes internal/control/
  // official-original placeholder rows from the count). PASSED and
  // VALIDATED are both treated as success because the canonical
  // helper uses isValidationPassed() under the hood.
  const documentBlockersCount = canonical.summary.documentBlockers;
  const tenderBlockersCount = canonical.summary.tenderLevelBlockers;
  const advisoryWarningsCount = canonical.summary.advisoryWarnings;
  const finalExportCandidates = canonical.summary.finalExportCandidates;
  const workspaceDocuments = canonical.summary.workspaceDocuments;
  const excludedInternalRows = canonical.summary.excludedInternalRows;
  const planStatus = canonical.summary.planStatus;
  const criticalGaps = tender.complianceGaps.filter((g) => g.severity === "CRITICAL");
  const highGaps = tender.complianceGaps.filter((g) => g.severity === "HIGH");

  const blockers: string[] = [];
  const warnings: string[] = [];
  if (tender.status === "NO_BID") blockers.push("Tender is marked NO_BID.");
  if (!fullProposalReady) blockers.push(...fullProposalBlockers.map((item) => item.message));
  if (documentBlockersCount > 0) blockers.push(`${documentBlockersCount} document blocker(s) on final export candidates.`);
  if (tenderBlockersCount > 0) blockers.push(`${tenderBlockersCount} tender-level blocker(s) on final export.`);
  if (criticalGaps.length > 0) blockers.push(`${criticalGaps.length} unresolved critical compliance gap(s).`);

  warnings.push(...generationReadiness.warnings.map((item) => item.message));
  if (advisoryWarningsCount > 0) warnings.push(`${advisoryWarningsCount} advisory warning(s) (donor safeguards / non-mandatory items).`);
  if (highGaps.length > 0) warnings.push(`${highGaps.length} unresolved high-severity review gap(s).`);

  // "Ready for export" pill must reflect canonical ok exactly so it
  // can never claim Yes when the export gate is blocked.
  let readyForExportLabel: string;
  if (canonical.ok) readyForExportLabel = advisoryWarningsCount > 0 ? "Yes (with advisories)" : "Yes";
  else readyForExportLabel = "No";

  const verdict: Verdict = tender.status === "NO_BID"
    ? "NO_BID"
    : blockers.length > 0
      ? "NOT_READY"
      : warnings.length > 0
        ? "BID_READY_WITH_WARNINGS"
        : "BID_READY";

  // Plan pill — when plan count is zero but active docs exist, show a
  // "Mismatch" indicator rather than a misleading "0/0" so the user knows
  // documents need reconciliation. When plan files exist, show the
  // resolved/total count derived from the canonical plan status.
  const planLabel = (() => {
    if (planStatus === "NO_PLAN_WITH_ACTIVE_DOCS") return "No plan";
    if (planStatus === "NO_PLAN_NO_DOCS") return "No plan";
    if (planStatus === "PLAN_MATCHED") return "Plan ✓";
    if (planStatus === "PLAN_MISSING_DOCS") return "Missing";
    if (planStatus === "PLAN_EXTRA_DOCS") return "Extras";
    if (planStatus === "PLAN_NAME_MISMATCH" || planStatus === "PLAN_ORDER_MISMATCH") return "Mismatch";
    if (!planStatus) return "No plan";
    return "—";
  })();
  const planLabelNote = (() => {
    if (planStatus === "NO_PLAN_WITH_ACTIVE_DOCS" || planStatus === "NO_PLAN_NO_DOCS" || !planStatus)
      return "Build submission plan first";
    return null;
  })();
  // Top reason why full proposal is blocked, for inline display
  const fullProposalBlockReason = !fullProposalReady && fullProposalBlockers.length > 0
    ? fullProposalBlockers[0].message
    : null;

  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${verdictClass(verdict)}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide">Bid control verdict</p>
          <h2 className="mt-1 text-2xl font-bold text-slate-900">{verdictLabel(verdict)}</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">Consolidates generation readiness, canonical export readiness, compliance gaps, and donor advisories into one bid-control signal.</p>
        </div>
        <div className="rounded-xl bg-white px-4 py-3 text-right shadow-sm">
          <p className="text-xs text-slate-500">Tender workflow status</p>
          <p className="text-sm font-bold text-slate-900">{statusText(tender.status)}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
        <div className="rounded-xl bg-white p-3" title="Strict gate — full proposal generation. Requires valid client metadata, real tender-specific matches with reviewed selections, non-zero matching score, and analysis quality not POOR.">
          <p className="text-xs text-slate-500">Full proposal</p>
          <p className={`text-lg font-bold ${fullProposalReady ? "text-emerald-700" : "text-red-700"}`}>{fullProposalReady ? "Ready" : "Blocked"}</p>
          {fullProposalBlockReason && <p className="mt-0.5 text-[10px] text-red-600 leading-tight">{fullProposalBlockReason}</p>}
        </div>
        <div className="rounded-xl bg-white p-3" title="Lenient gate — support / compliance file generation. Allows vault fallback evidence.">
          <p className="text-xs text-slate-500">Support pkg</p>
          <p className={`text-lg font-bold ${supportPackageReady ? "text-emerald-700" : "text-red-700"}`}>{supportPackageReady ? "Ready" : "Blocked"}</p>
        </div>
        <div className="rounded-xl bg-white p-3" title="Submission plan status (NO_PLAN_NO_DOCS / NO_PLAN_WITH_ACTIVE_DOCS / PLAN_MATCHED / PLAN_MISSING_DOCS / PLAN_EXTRA_DOCS / PLAN_ORDER_MISMATCH / PLAN_NAME_MISMATCH)."><p className="text-xs text-slate-500">Plan files</p><p className={`text-lg font-bold ${planStatus === "PLAN_MATCHED" ? "text-emerald-700" : "text-slate-900"}`}>{planLabel}</p>{planLabelNote && <p className="mt-0.5 text-[10px] text-amber-600 leading-tight">{planLabelNote}</p>}</div>
        <div className="rounded-xl bg-white p-3" title={`Workspace rows: ${workspaceDocuments}. Final export candidates: ${finalExportCandidates}. Excluded internal/control rows: ${excludedInternalRows}.`}><p className="text-xs text-slate-500">Workspace · Final</p><p className="text-lg font-bold text-slate-900">{workspaceDocuments} · {finalExportCandidates}</p>{workspaceDocuments > 0 && finalExportCandidates === 0 && <p className="mt-0.5 text-[10px] text-amber-600 leading-tight">review quality/classification</p>}</div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Doc blockers</p><p className={`text-lg font-bold ${documentBlockersCount === 0 ? "text-emerald-700" : "text-red-700"}`}>{documentBlockersCount}</p></div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Critical gaps</p><p className={`text-lg font-bold ${criticalGaps.length === 0 ? "text-emerald-700" : "text-red-700"}`}>{criticalGaps.length}</p></div>
        <div className="rounded-xl bg-white p-3" title="Canonical Export Gate result. Yes only when canonical.ok === true; advisories never flip this to No."><p className="text-xs text-slate-500">Ready for export</p><p className={`text-lg font-bold ${canonical.ok ? "text-emerald-700" : "text-red-700"}`}>{readyForExportLabel}</p></div>
      </div>

      {workspaceDocuments > 0 && excludedInternalRows > 0 && (
        <p className="mt-2 text-[11px] text-slate-500">
          {excludedInternalRows} workspace row(s) (control / quick-draft / planned / official-original placeholder) are excluded from final-export blocker counts.
        </p>
      )}

      {blockers.length > 0 && (
        <div className="mt-4 rounded-xl border border-red-200 bg-white p-3 text-sm text-red-800">
          <p className="font-semibold">Blockers to fix before submission</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">{blockers.slice(0, 8).map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-white p-3 text-sm text-amber-800">
          <p className="font-semibold">Warnings / advisories</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">{warnings.slice(0, 8).map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      )}
      <BidDecisionForm tenderId={tenderId} />
    </section>
  );
}
