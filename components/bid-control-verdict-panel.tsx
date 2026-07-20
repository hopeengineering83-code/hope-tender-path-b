import { getCurrentUser } from "../lib/auth";
import { canMutateTender } from "../lib/recovery-command-actions";
import { prisma, prismaReady } from "../lib/prisma";
import { getTenderGenerationReadinessStrict } from "../lib/tender-generation-readiness-strict";
import { getFinalSubmissionReadiness } from "../lib/engine/final-submission-readiness";
import { getFinalPackageReadinessModel } from "../lib/engine/final-package-readiness-model";
import { BidDecisionForm } from "./bid-decision-form";
import { SnapshotConsistencyBadge } from "./snapshot-consistency-badge";
import { clientLogger } from "@/lib/ui/client-logger";

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

function analysisSourceFromNotes(notes: string | null | undefined): string {
  if (!notes) return "Not analyzed";
  if (/HUMAN.APPROVED.REGEX.FALLBACK/i.test(notes) || /human.approved/i.test(notes)) return "Human-approved fallback";
  if (/REGEX_FALLBACK|regex fallback/i.test(notes)) return "Regex fallback (provisional)";
  if (/Analysis source:\s*AI\b/i.test(notes) || /analysi[zs]ed.*AI/i.test(notes)) return "AI verified";
  if (/ANALYZED/i.test(notes)) return "AI verified";
  return "Not analyzed";
}

export async function BidControlVerdictPanel({ tenderId }: { tenderId: string }) {
  // Role gate: the BidDecisionForm renders an "Evaluate & Record Bid Decision"
  // button that POSTs to /api/tenders/[id]/bid-decision — a mutation route
  // server-gated to ADMIN/PROPOSAL_MANAGER. REVIEWER/VIEWER must never see the
  // form. Previously this used getSession() (which returns only userId, never
  // role) and rendered the form unconditionally.
  const user = await getCurrentUser();
  if (!user) return null;
  const userId = user.id;
  const canMutate = canMutateTender(user.role);

  try {
    await prismaReady;

  const [generationReadiness, canonical, finalPackage, tender] = await Promise.all([
    getTenderGenerationReadinessStrict(prisma, userId, tenderId).catch((error) => {
      clientLogger.error("[BidControlVerdictPanel] generation readiness failed", {
        tenderId,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
      return null;
    }),
    getFinalSubmissionReadiness(prisma, { tenderId, userId, requireFileContent: false }).catch((error) => {
      clientLogger.error("[BidControlVerdictPanel] final readiness failed", {
        tenderId,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
      return null;
    }),
    getFinalPackageReadinessModel(prisma, tenderId, userId).catch((error) => {
      clientLogger.error("[BidControlVerdictPanel] final package readiness failed", {
        tenderId,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
      return null;
    }),
    prisma.tender.findFirst({
      where: { id: tenderId, userId },
      select: {
        id: true,
        title: true,
        status: true,
        notes: true,
        complianceGaps: { where: { isResolved: false, severity: { in: ["CRITICAL", "HIGH"] } }, select: { id: true, severity: true } },
      },
    }),
  ]);

  if (!tender) return null;
  if (!generationReadiness || !canonical || !finalPackage) {
    return (
      <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bid control verdict</p>
        <h2 className="mt-1 text-2xl font-bold text-slate-900">Loading…</h2>
        <p className="mt-1 text-sm text-slate-600">Bid control is computing the latest readiness state. Refresh to retry.</p>
      </section>
    );
  }

  const fullProposalReady = Boolean(generationReadiness.fullProposalReady);
  const supportPackageReady = Boolean(generationReadiness.supportPackageReady);
  const fullProposalBlockers = generationReadiness.fullProposalBlockers ?? [];

  // Per spec: Bid Control must not show internal cards as Ready when the
  // authoritative release snapshot is blocked. Check for stale analysis,
  // no compliance rows, and PDF required but unavailable — these are
  // canonical snapshot blockers that the strict gate may not catch.
  const hasStaleAnalysis = fullProposalBlockers.some((b) =>
    b.code === "STALE_ANALYSIS" || b.code === "ANALYSIS_HASH_MISMATCH"
  );
  const hasNoComplianceRows = fullProposalBlockers.some((b) =>
    b.code === "MANDATORY_NO_COMPLIANCE_ROWS" || b.code === "EVIDENCE_NOT_ASSESSED"
  );
  const hasSnapshotBlocker = hasStaleAnalysis || hasNoComplianceRows || !canonical.ok;
  // If any snapshot blocker exists, force the cards to show Blocked/Stale
  // instead of Ready — the strict gate alone is not authoritative.
  const effectiveFullProposalReady = fullProposalReady && !hasSnapshotBlocker;
  const effectiveSupportPackageReady = supportPackageReady && !hasStaleAnalysis;

  const documentBlockersCount = finalPackage.documents.blockers.length;
  const tenderBlockersCount = canonical.summary.tenderLevelBlockers + finalPackage.requirements.blockers.length;
  const advisoryWarningsCount = canonical.summary.advisoryWarnings;
  const finalExportCandidates = finalPackage.export.exportCandidateCount;
  const workspaceDocuments = finalPackage.export.workspaceCount;
  const excludedInternalRows = finalPackage.documents.extraGeneratedOutsidePlan.length;
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

  const readyForExportLabel = canonical.ok
    ? advisoryWarningsCount > 0 ? "Yes (with advisories)" : "Yes"
    : "No";

  const verdict: Verdict = tender.status === "NO_BID"
    ? "NO_BID"
    : blockers.length > 0
      ? "NOT_READY"
      : warnings.length > 0
        ? "BID_READY_WITH_WARNINGS"
        : "BID_READY";

  const planLabel = (() => {
    if (planStatus === "NO_PLAN_WITH_ACTIVE_DOCS") return "Not detected";
    if (planStatus === "NO_PLAN_NO_DOCS") return "Not detected";
    if (planStatus === "PLAN_MATCHED") return "Plan matched";
    if (planStatus === "PLAN_MISSING_DOCS") return "Missing docs";
    if (planStatus === "PLAN_EXTRA_DOCS") return "Extra docs";
    if (planStatus === "DERIVED_PLAN_UNCONFIRMED") return "Derived plan";
    if (planStatus === "PLAN_NAME_MISMATCH" || planStatus === "PLAN_ORDER_MISMATCH") return "Mismatch";
    if (!planStatus) return "Not detected";
    return "—";
  })();
  const planLabelNote = (() => {
    if (planStatus === "NO_PLAN_WITH_ACTIVE_DOCS") return "Build submission plan — docs exist outside plan";
    if (planStatus === "NO_PLAN_NO_DOCS" || !planStatus) return "Build submission plan first";
    if (planStatus === "DERIVED_PLAN_UNCONFIRMED") return "Confirm exact tender file names/order before export";
    return null;
  })();
  const fullProposalBlockReason = !fullProposalReady && fullProposalBlockers.length > 0
    ? fullProposalBlockers[0].message
    : null;

  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${verdictClass(verdict)}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide">Bid control verdict</p>
          <h2 className="mt-1 text-2xl font-bold text-slate-900">{verdictLabel(verdict)}</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">Consolidates strict generation readiness, canonical export readiness, compliance gaps, and donor advisories into one bid-control signal.</p>
        </div>
        <div className="rounded-xl bg-white px-4 py-3 text-right shadow-sm">
          <p className="text-xs text-slate-500">Analysis</p>
          <p className={`text-sm font-bold ${hasStaleAnalysis ? "text-amber-800" : "text-slate-900"}`}>
            {hasStaleAnalysis ? "Stale — re-run required" : analysisSourceFromNotes(tender.notes)}
          </p>
          <p className="text-[10px] text-slate-400">{statusText(tender.status)}</p>
        </div>
      </div>

      {/* Additive honest-UI overlay: warn if this panel's strict full-proposal
          verdict disagrees with the authoritative release-snapshot generation
          verdict. Read-and-compare only; never replaces the logic above. */}
      <SnapshotConsistencyBadge
        tenderId={tenderId}
        verdict="generation"
        localEligible={fullProposalReady}
        localLabel="Bid Control"
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
        <div className="rounded-xl bg-white p-3" title="Strict gate — full proposal generation.">
          <p className="text-xs text-slate-500">Full proposal</p>
          <p className={`text-lg font-bold ${effectiveFullProposalReady ? "text-emerald-700" : "text-red-700"}`}>{effectiveFullProposalReady ? "Ready" : "Blocked"}</p>
          {fullProposalBlockReason && <p className="mt-0.5 text-[10px] text-red-600 leading-tight">{fullProposalBlockReason}</p>}
        </div>
        <div className="rounded-xl bg-white p-3" title="Support / compliance file generation gate.">
          <p className="text-xs text-slate-500">Support pkg</p>
          <p className={`text-lg font-bold ${effectiveSupportPackageReady ? "text-emerald-700" : "text-red-700"}`}>{effectiveSupportPackageReady ? "Ready" : "Blocked"}</p>
        </div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Plan files</p><p className={`text-lg font-bold ${planStatus === "PLAN_MATCHED" ? "text-emerald-700" : "text-slate-900"}`}>{planLabel}</p>{planLabelNote && <p className="mt-0.5 text-[10px] text-amber-600 leading-tight">{planLabelNote}</p>}</div>
        <div className="rounded-xl bg-white p-3" title={`Workspace rows: ${workspaceDocuments}. Final export candidates: ${finalExportCandidates}. Excluded internal/control rows: ${excludedInternalRows}.`}><p className="text-xs text-slate-500">Workspace / export</p><p className="text-lg font-bold text-slate-900">{workspaceDocuments} / {finalExportCandidates}</p>{workspaceDocuments > 0 && finalExportCandidates === 0 && <p className="mt-0.5 text-[10px] text-amber-600 leading-tight">{workspaceDocuments} workspace rows, 0 export candidates — review quality/classification</p>}</div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Doc blockers</p><p className={`text-lg font-bold ${documentBlockersCount === 0 ? "text-emerald-700" : "text-red-700"}`}>{documentBlockersCount}</p>{finalPackage.documents.blockers[0] && <p className="mt-0.5 text-[10px] text-red-600 leading-tight">{finalPackage.documents.blockers[0].documentName}: {finalPackage.documents.blockers[0].reason}</p>}</div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Registered gaps</p><p className={`text-lg font-bold ${criticalGaps.length + highGaps.length === 0 ? "text-emerald-700" : "text-red-700"}`}>{criticalGaps.length + highGaps.length}</p><p className="text-[10px] text-slate-400">{criticalGaps.length} critical, {highGaps.length} high</p></div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Ready for export</p><p className={`text-lg font-bold ${canonical.ok ? "text-emerald-700" : "text-red-700"}`}>{readyForExportLabel}</p></div>
      </div>

      {workspaceDocuments > 0 && excludedInternalRows > 0 && (
        <p className="mt-2 text-[11px] text-slate-500">{excludedInternalRows} workspace row(s) are excluded from final-export blocker counts.</p>
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
      {canMutate && <BidDecisionForm tenderId={tenderId} />}
    </section>
  );
  } catch (error) {
    // Never expose raw Prisma errors to the UI — log server-side, show safe fallback.
    clientLogger.error("[BidControlVerdictPanel] unhandled error", {
      tenderId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return (
      <section className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
        <p className="font-semibold">Bid control verdict unavailable</p>
        <p className="mt-1 text-xs">Refresh to retry. If the problem persists, contact admin.</p>
      </section>
    );
  }
}
