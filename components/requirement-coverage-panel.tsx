"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, RefreshIcon, WarningIcon, CheckIcon, CrossIcon } from "./icons";

type SupportLevel = "FULL" | "SUBSTANTIAL" | "PARTIAL" | "NONE" | "NOT_APPLICABLE";
type CoverageStatus = "FULLY_MET" | "PARTIALLY_MET" | "NOT_MET" | "NEEDS_TRACE";

type EvidenceLink = {
  id: string;
  evidenceType: string;
  evidenceSource: string;
  evidenceReference: string | null;
  supportLevel: string;
  autoLinked?: boolean;
};

type RequirementCoverageRow = {
  id: string;
  title: string;
  requirementType: string;
  priority: string;
  sectionReference: string | null;
  sourcePageNumber: number | null;
  sourceSectionHeading: string | null;
  sourceExactQuote: string | null;
  sourceConfidence: number;
  hasSourceRef: boolean;
  evidenceLinks: EvidenceLink[];
  supportLevel: SupportLevel;
  coverageStatus: CoverageStatus;
  isFullyCovered: boolean;
  nextAction: string;
};

type CoverageData = {
  totalMandatory: number;
  fullyCovered: number;
  partiallyCovered: number;
  needsTrace: number;
  uncovered: number;
  missingSourceRef: number;
  coverageRatio: number;
  rows: RequirementCoverageRow[];
};

const SUPPORT_LEVEL_CONFIG: Record<SupportLevel, { label: string; color: string; dot: string }> = {
  FULL: { label: "Full", color: "bg-green-100 text-green-800 border-green-300", dot: "bg-green-500" },
  SUBSTANTIAL: { label: "Substantial", color: "bg-blue-100 text-blue-800 border-blue-300", dot: "bg-blue-500" },
  PARTIAL: { label: "Partial", color: "bg-amber-100 text-amber-800 border-amber-300", dot: "bg-amber-500" },
  NONE: { label: "Not covered", color: "bg-red-100 text-red-800 border-red-300", dot: "bg-red-500" },
  NOT_APPLICABLE: { label: "N/A", color: "bg-gray-100 text-gray-600 border-gray-300", dot: "bg-gray-400" },
};

const COVERAGE_STATUS_CONFIG: Record<CoverageStatus, { label: string; color: string; dot: string }> = {
  FULLY_MET: { label: "Covered", color: "bg-green-100 text-green-800 border-green-300", dot: "bg-green-500" },
  PARTIALLY_MET: { label: "Partial", color: "bg-amber-100 text-amber-800 border-amber-300", dot: "bg-amber-500" },
  NEEDS_TRACE: { label: "Needs source trace", color: "bg-orange-100 text-orange-800 border-orange-300", dot: "bg-orange-500" },
  NOT_MET: { label: "Not covered", color: "bg-red-100 text-red-800 border-red-300", dot: "bg-red-500" },
};

const REQ_TYPE_LABELS: Record<string, string> = {
  EXPERT: "Expert",
  PROJECT_EXPERIENCE: "Project",
  TECHNICAL: "Technical",
  FINANCIAL: "Financial",
  ELIGIBILITY: "Eligibility",
  DECLARATION: "Declaration",
  FORM: "Form",
  ANNEX: "Annex",
  METHODOLOGY: "Methodology",
  COMPANY_PROFILE: "Company",
  SUBMISSION_RULE: "Submission",
};

type ActionState = { pending: boolean; error: string | null; success: string | null };
type CoverageActionType = "CONFIRM_FULL" | "CONFIRM_SUBSTANTIAL" | "MARK_NA";

type TraceabilitySummary = {
  requirements: number;
  weakRequirements: number;
  selectedExpertsWithWeakEvidence: number;
  selectedProjectsWithWeakEvidence: number;
};

export default function RequirementCoveragePanel({ tenderId, canMutate = false }: { tenderId: string; canMutate?: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<CoverageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<"ALL" | "UNCOVERED" | "PARTIAL" | "COVERED">("UNCOVERED");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [traceability, setTraceability] = useState<{ summary: TraceabilitySummary; warnings: string[] } | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [confirmAllResult, setConfirmAllResult] = useState<string | null>(null);
  const [coverageActionStates, setCoverageActionStates] = useState<Record<string, ActionState>>({});
  const [naReasonPrompt, setNaReasonPrompt] = useState<{ requirementId: string; title: string } | null>(null);
  const [naReasonValue, setNaReasonValue] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/requirement-coverage`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Failed to load coverage");
      setData(json as CoverageData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load coverage");
    } finally {
      setLoading(false);
    }
  }, [tenderId]);

  useEffect(() => { void load(); }, [load]);

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setLinkAction = (key: string, state: ActionState) =>
    setActionStates((prev) => ({ ...prev, [key]: state }));

  const confirmEvidence = async (requirementId: string, link: EvidenceLink) => {
    const key = `${requirementId}-${link.id}`;
    setLinkAction(key, { pending: true, error: null, success: null });
    try {
      const res = await fetch(`/api/tenders/${tenderId}/requirement-coverage/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requirementId,
          evidenceType: link.evidenceType,
          evidenceReference: link.evidenceReference,
          supportLevel: "PARTIAL",
          notes: "Confirmed auto-linked vault evidence as PARTIAL. FULL/SUBSTANTIAL requires compliance-matrix traceability review.",
        }),
      });
      const json = await res.json() as { ok?: boolean; error?: string; code?: string };
      if (!res.ok || !json.ok) {
        setLinkAction(key, { pending: false, error: json.error ?? "Failed to confirm evidence", success: null });
        return;
      }
      setLinkAction(key, { pending: false, error: null, success: "Confirmed" });
      void load();
      router.refresh();
    } catch (e) {
      setLinkAction(key, { pending: false, error: e instanceof Error ? e.message : "Network error", success: null });
    }
  };

  const rejectEvidence = async (requirementId: string, link: EvidenceLink) => {
    const key = `${requirementId}-${link.id}-reject`;
    setLinkAction(key, { pending: true, error: null, success: null });
    try {
      const res = await fetch(`/api/tenders/${tenderId}/requirement-coverage/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requirementId,
          evidenceType: link.evidenceType,
          evidenceReference: link.evidenceReference,
          reason: "Rejected by reviewer — does not satisfy this requirement.",
        }),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setLinkAction(key, { pending: false, error: json.error ?? "Failed to reject evidence", success: null });
        return;
      }
      setLinkAction(key, { pending: false, error: null, success: "Rejected" });
      router.refresh();
    } catch (e) {
      setLinkAction(key, { pending: false, error: e instanceof Error ? e.message : "Network error", success: null });
    }
  };

  const confirmAllSafe = async () => {
    if (!data) return;
    const autoLinks = data.rows.flatMap((row) =>
      row.evidenceLinks
        .filter((link) => link.autoLinked && !actionStates[`${row.id}-${link.id}`]?.success)
        .map((link) => ({ requirementId: row.id, link }))
    );
    if (autoLinks.length === 0) { setConfirmAllResult("No unconfirmed auto-linked suggestions found."); return; }
    setConfirmingAll(true);
    setConfirmAllResult(null);
    let confirmed = 0;
    for (const { requirementId, link } of autoLinks) {
      try {
        const res = await fetch(`/api/tenders/${tenderId}/requirement-coverage/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requirementId, evidenceType: link.evidenceType, evidenceReference: link.evidenceReference, supportLevel: "PARTIAL", notes: "Bulk-confirmed auto-linked vault evidence as PARTIAL. FULL/SUBSTANTIAL requires compliance-matrix traceability review." }),
        });
        const json = await res.json() as { ok?: boolean };
        if (res.ok && json.ok) {
          confirmed++;
          setLinkAction(`${requirementId}-${link.id}`, { pending: false, error: null, success: "Confirmed" });
        }
      } catch { /* continue remaining items */ }
    }
    setConfirmingAll(false);
    setConfirmAllResult(`Confirmed ${confirmed} of ${autoLinks.length} auto-linked suggestion(s).`);
    void load();
    router.refresh();
  };

  const applyCoverageAction = async (requirementId: string, action: CoverageActionType, reason?: string) => {
    const key = `${requirementId}:${action}`;
    setCoverageActionStates((prev) => ({ ...prev, [key]: { pending: true, error: null, success: null } }));
    try {
      let supportLevel: string;
      let notes: string;
      if (action === "CONFIRM_FULL") {
        supportLevel = "FULL";
        notes = "Manually confirmed as FULL coverage by reviewer.";
      } else if (action === "CONFIRM_SUBSTANTIAL") {
        supportLevel = "SUBSTANTIAL";
        notes = "Manually confirmed as SUBSTANTIAL coverage by reviewer.";
      } else {
        supportLevel = "NOT_APPLICABLE";
        notes = reason ? `Marked N/A: ${reason}` : "Marked as NOT_APPLICABLE by reviewer.";
      }
      // Use the compliance matrix update endpoint via the confirm route
      // with a special evidence type indicating manual reviewer confirmation.
      const res = await fetch(`/api/tenders/${tenderId}/requirement-coverage/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requirementId,
          evidenceType: "MANUAL_REVIEWER_CONFIRMATION",
          supportLevel,
          notes,
        }),
      });
      const json = await res.json() as { ok?: boolean; error?: string; code?: string };
      if (!res.ok || !json.ok) {
        setCoverageActionStates((prev) => ({
          ...prev,
          [key]: {
            pending: false,
            error: json.error ?? "Failed to update coverage",
            success: null,
          },
        }));
        return;
      }
      setCoverageActionStates((prev) => ({ ...prev, [key]: { pending: false, error: null, success: `Set to ${supportLevel}` } }));
      void load();
      router.refresh();
    } catch (e) {
      setCoverageActionStates((prev) => ({ ...prev, [key]: { pending: false, error: e instanceof Error ? e.message : "Network error", success: null } }));
    }
  };

  const loadTraceability = async () => {
    if (traceOpen && traceability) { setTraceOpen(false); return; }
    setTraceOpen(true);
    if (traceability) return;
    setTraceLoading(true);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/traceability`);
      const json = await res.json() as { success?: boolean; traceability?: { summary: TraceabilitySummary; warnings: string[] }; error?: string };
      if (!res.ok || !json.success || !json.traceability) return;
      setTraceability({ summary: json.traceability.summary, warnings: (json.traceability.warnings ?? []).filter(Boolean) as string[] });
    } catch {
      // silently fail — traceability is a non-critical diagnostic
    } finally {
      setTraceLoading(false);
    }
  };

  // Every branch below carries id="requirement-coverage" — this is the
  // Workflow Control Center's "Review Requirements" scroll anchor
  // (tender-workflow-action-center.tsx targets map) and NextActionPanel
  // link target. It must stay attached in the loading/error/empty states
  // too, or clicking the button in those states silently does nothing.
  if (loading) {
    return (
      <div id="requirement-coverage" className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          Loading mandatory requirement coverage…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div id="requirement-coverage" className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">{error ?? "Unable to load requirement coverage."}</p>
        <button onClick={load} className="mt-2 text-xs text-red-600 underline">Retry</button>
      </div>
    );
  }

  if (data.totalMandatory === 0) {
    return (
      <div id="requirement-coverage" className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm text-gray-500">No mandatory requirements found. Run AI Analyze or Run Engine to extract requirements.</p>
      </div>
    );
  }

  const coveragePct = Math.round(data.coverageRatio * 100);
  const filteredRows = data.rows.filter((r) => {
    if (filter === "UNCOVERED") return r.coverageStatus === "NOT_MET";
    if (filter === "PARTIAL") return r.coverageStatus === "PARTIALLY_MET" || r.coverageStatus === "NEEDS_TRACE";
    if (filter === "COVERED") return r.isFullyCovered;
    return true;
  });

  return (
    <div id="requirement-coverage" className="rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-800">Mandatory Requirement Coverage</span>
          <div className="flex items-center gap-2">
            <div className="h-2 w-24 overflow-hidden rounded-full bg-gray-200">
              <div
                className={`h-full rounded-full transition-all ${coveragePct >= 80 ? "bg-green-500" : coveragePct >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                style={{ width: `${coveragePct}%` }}
              />
            </div>
            <span className={`text-xs font-semibold ${coveragePct >= 80 ? "text-green-700" : coveragePct >= 50 ? "text-amber-800" : "text-red-700"}`}>
              {coveragePct}%
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={load} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100" aria-label="Refresh coverage"><RefreshIcon /></button>
          {data && data.rows.some((r) => r.evidenceLinks.some((l) => l.autoLinked && !actionStates[`${r.id}-${l.id}`]?.success)) && (
            <button
              type="button"
              onClick={() => void confirmAllSafe()}
              style={canMutate ? undefined : { display: "none" }}
              disabled={confirmingAll}
              className="rounded border border-green-300 bg-green-50 px-2 py-1 text-xs font-medium text-green-800 hover:bg-green-100 disabled:opacity-60"
            >
              {confirmingAll ? "Confirming…" : "Confirm all as partial"}
            </button>
          )}
          <button type="button" onClick={() => void loadTraceability()} disabled={traceLoading} aria-expanded={traceOpen} aria-controls="traceability-panel" className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-60">
            {traceLoading ? "…" : <><ChevronDownIcon className={traceOpen ? "inline h-3 w-3 rotate-180" : "inline h-3 w-3"} /> Traceability</>}
          </button>
          <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} aria-controls="req-coverage-list" className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100">
            {expanded ? <><ChevronDownIcon className="rotate-180" /> Collapse</> : <><ChevronDownIcon /> Show requirements</>}
          </button>
        </div>
      </div>

      {confirmAllResult && (
        <div className="border-b border-green-100 bg-green-50 px-5 py-2 text-xs text-green-800">{confirmAllResult}</div>
      )}

      <div className="border-b border-amber-100 bg-amber-50 px-5 py-2 text-xs text-amber-800">
        Auto-linked vault suggestions can only be confirmed as PARTIAL in this panel. FULL/SUBSTANTIAL coverage requires a compliance-matrix confirmation with traceable source support.
      </div>

      {/* Traceability summary */}
      {traceOpen && traceability && (
        <div id="traceability-panel" className="border-b border-gray-100 px-5 py-3 bg-amber-50">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 mb-2">Traceability Audit</p>
          <div className="grid grid-cols-4 gap-3 text-xs text-center">
            <div><div className="text-base font-bold text-gray-800">{traceability.summary.requirements}</div><div className="text-gray-500">Requirements</div></div>
            <div><div className={`text-base font-bold ${traceability.summary.weakRequirements > 0 ? "text-red-600" : "text-green-600"}`}>{traceability.summary.weakRequirements}</div><div className="text-gray-500">Weak source</div></div>
            <div><div className={`text-base font-bold ${traceability.summary.selectedExpertsWithWeakEvidence > 0 ? "text-amber-600" : "text-green-600"}`}>{traceability.summary.selectedExpertsWithWeakEvidence}</div><div className="text-gray-500">Weak experts</div></div>
            <div><div className={`text-base font-bold ${traceability.summary.selectedProjectsWithWeakEvidence > 0 ? "text-amber-600" : "text-green-600"}`}>{traceability.summary.selectedProjectsWithWeakEvidence}</div><div className="text-gray-500">Weak projects</div></div>
          </div>
          {traceability.warnings.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-amber-800">
              {traceability.warnings.map((w) => <li key={w} className="inline-flex items-start gap-1"><WarningIcon className="mt-0.5 shrink-0" /> <span>{w}</span></li>)}
            </ul>
          )}
          {traceability.warnings.length === 0 && coveragePct > 0 && (
            <p className="mt-2 text-xs text-green-700">All requirements and selected evidence have acceptable traceability.</p>
          )}
          {traceability.warnings.length === 0 && coveragePct === 0 && (
            <p className="mt-2 text-xs text-amber-800">No compliance coverage has been confirmed yet. Source traceability may be acceptable, but requirement coverage is not yet confirmed.</p>
          )}
        </div>
      )}

      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-px border-b border-gray-100 bg-gray-100 text-center text-xs sm:grid-cols-6">
        {[
          { label: "Mandatory", value: data.totalMandatory, color: "text-gray-800" },
          { label: "Traced", value: data.totalMandatory - data.missingSourceRef, color: "text-blue-700" },
          { label: "Covered", value: data.fullyCovered, color: "text-green-700" },
          { label: "Partial", value: data.partiallyCovered, color: "text-amber-800" },
          { label: "Needs trace", value: data.needsTrace, color: data.needsTrace > 0 ? "text-orange-700" : "text-gray-400" },
          { label: "Uncovered", value: data.uncovered, color: data.uncovered > 0 ? "text-red-600" : "text-gray-400" },
        ].map((cell) => (
          <div key={cell.label} className="bg-white py-2">
            <div className={`text-base font-bold ${cell.color}`}>{cell.value}</div>
            <div className="text-gray-500">{cell.label}</div>
          </div>
        ))}
      </div>

      {/* Source ref warning */}
      {data.missingSourceRef > 0 && (
        <div className="inline-flex items-start gap-1 border-b border-amber-100 bg-amber-50 px-5 py-2 text-xs text-amber-800">
          <WarningIcon className="mt-0.5 shrink-0" /> <span>{data.missingSourceRef} requirements are &quot;raw fallback&quot; (no source tracing). Trusted tracing required for final export.</span>
        </div>
      )}

      {/* Requirement list */}
      {expanded && (
        <div id="req-coverage-list" className="divide-y divide-gray-100">
          {/* Filter tabs */}
          <div className="flex gap-1 px-5 py-2">
            {(["ALL", "UNCOVERED", "PARTIAL", "COVERED"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${filter === f ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >
                {f === "ALL" ? `All (${data.rows.length})` : f === "UNCOVERED" ? `Uncovered (${data.uncovered})` : f === "PARTIAL" ? `Partial (${data.partiallyCovered})` : `Covered (${data.fullyCovered})`}
              </button>
            ))}
          </div>

          {filteredRows.length === 0 && (
            <div className="px-5 py-4 text-sm text-gray-500">No requirements match this filter.</div>
          )}

          {filteredRows.map((row) => {
            const cfg = COVERAGE_STATUS_CONFIG[row.coverageStatus] ?? COVERAGE_STATUS_CONFIG.NOT_MET;
            const isOpen = expandedRows.has(row.id);
            return (
              <div key={row.id} className="px-5 py-3">
                <button
                  type="button"
                  onClick={() => toggleRow(row.id)}
                  aria-expanded={isOpen}
                  aria-controls={`req-row-${row.id}`}
                  className="flex w-full items-start gap-3 text-left"
                >
                  <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${cfg.dot}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{row.title}</span>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                        {REQ_TYPE_LABELS[row.requirementType] ?? row.requirementType}
                      </span>
                      <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${cfg.color}`}>
                        {cfg.label}
                      </span>
                      {!row.hasSourceRef && (
                        <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">
                          No source ref
                        </span>
                      )}
                    </div>
                    {!isOpen && (
                      <p className="mt-0.5 text-xs text-gray-500">{row.nextAction}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-gray-400"><ChevronDownIcon className={isOpen ? "rotate-180" : ""} /></span>
                </button>

                {isOpen && (
                  <div id={`req-row-${row.id}`} className="ml-5 mt-2 space-y-3">
                    {/* Source reference */}
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Source Reference</p>
                      {row.hasSourceRef ? (
                        <div className="text-xs text-gray-700 space-y-0.5">
                          {row.sectionReference && <div>Section: {row.sectionReference}</div>}
                          {row.sourcePageNumber && <div>Page: {row.sourcePageNumber}</div>}
                          {row.sourceSectionHeading && <div>Heading: {row.sourceSectionHeading}</div>}
                          {row.sourceExactQuote && (
                            <blockquote className="mt-1 border-l-2 border-gray-300 pl-2 text-gray-600 italic">
                              &ldquo;{row.sourceExactQuote.slice(0, 200)}{row.sourceExactQuote.length > 200 ? "…" : ""}&rdquo;
                            </blockquote>
                          )}
                          {(() => {
                            const pct = Math.round((row.sourceConfidence ?? 0) * 100);
                            const cls = pct >= 70
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : pct >= 40
                                ? "bg-amber-50 text-amber-800 border-amber-200"
                                : "bg-red-50 text-red-700 border-red-200";
                            const label = pct >= 70 ? "high" : pct >= 40 ? "med" : "low";
                            return (
                              <span
                                className={`inline-flex items-center rounded border px-1 py-0.5 text-[9px] font-medium ${cls}`}
                                title="Source confidence: how reliably this requirement was traced to the tender document"
                              >
                                {pct}% conf ({label})
                              </span>
                            );
                          })()}
                        </div>
                      ) : (
                        <p className="inline-flex items-start gap-1 text-xs text-amber-800"><WarningIcon className="mt-0.5 shrink-0" /> <span>No source reference recorded. Run source extraction or add manually.</span></p>
                      )}
                    </div>

                    {/* Evidence links */}
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                        Evidence Links ({row.evidenceLinks.length})
                      </p>
                      {row.evidenceLinks.length === 0 ? (
                        <p className="text-xs text-red-600">No evidence linked. Use vault evidence or run Engine.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {row.evidenceLinks.map((link) => {
                            const lCfg = SUPPORT_LEVEL_CONFIG[link.supportLevel as SupportLevel] ?? SUPPORT_LEVEL_CONFIG.PARTIAL;
                            const confirmKey = `${row.id}-${link.id}`;
                            const rejectKey = `${row.id}-${link.id}-reject`;
                            const confirmState = actionStates[confirmKey];
                            const rejectState = actionStates[rejectKey];
                            return (
                              <li key={link.id} className="rounded border border-gray-100 bg-gray-50 px-2 py-1.5">
                                <div className="flex items-center gap-2 text-xs text-gray-700 flex-wrap">
                                  <span className={`h-2 w-2 shrink-0 rounded-full ${lCfg.dot}`} />
                                  <span className="font-medium">{link.evidenceType}</span>
                                  <span className="text-gray-500">—</span>
                                  <span className="truncate">{link.evidenceSource}</span>
                                  {link.evidenceReference && <span className="text-gray-400 shrink-0">({link.evidenceReference})</span>}
                                  <span className={`shrink-0 rounded border px-1 py-0.5 text-xs ${lCfg.color}`}>{link.supportLevel}</span>
                                  {link.autoLinked && <span className="rounded bg-blue-100 px-1 py-0.5 text-[10px] font-medium text-blue-700">auto-linked</span>}
                                </div>
                                {link.autoLinked && (
                                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                                    {confirmState?.success ? (
                                      <span className="inline-flex items-center gap-0.5 text-[10px] text-green-700 font-medium">{confirmState.success} <CheckIcon /></span>
                                    ) : rejectState?.success ? (
                                      <span className="inline-flex items-center gap-0.5 text-[10px] text-red-700 font-medium">{rejectState.success} <CrossIcon /></span>
                                    ) : (
                                      <>
                                        {canMutate ? (
                                          <>
                                            <button
                                              onClick={() => void confirmEvidence(row.id, link)}
                                              disabled={confirmState?.pending || rejectState?.pending}
                                              className="inline-flex items-center gap-1 rounded bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800 hover:bg-green-200 disabled:opacity-60"
                                              title="Confirm partial evidence as sufficient"
                                            >
                                              <CheckIcon /> {confirmState?.pending ? "…" : "Confirm partial evidence"}
                                            </button>
                                            <button
                                              onClick={() => void rejectEvidence(row.id, link)}
                                              disabled={confirmState?.pending || rejectState?.pending}
                                              className="inline-flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 hover:bg-red-200 disabled:opacity-60"
                                              title="Mark evidence as not applicable"
                                            >
                                              <CrossIcon /> {rejectState?.pending ? "…" : "Not applicable"}
                                            </button>
                                          </>
                                        ) : (
                                          <span className="text-[10px] text-slate-400 italic">Read-only</span>
                                        )}
                                      </>
                                    )}
                                    {(confirmState?.error || rejectState?.error) && (
                                      <span className="text-[10px] text-red-600">{confirmState?.error ?? rejectState?.error}</span>
                                    )}
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>

                    {/* Next action */}
                    <div className="rounded border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                      <span className="font-medium">Next action: </span>{row.nextAction}
                    </div>

                    {/* Coverage confirmation actions for PARTIAL/NONE mandatory requirements */}
                    {row.priority === "MANDATORY" && row.hasSourceRef && (row.supportLevel === "PARTIAL" || row.supportLevel === "NONE") && (
                      <div className="rounded border border-slate-100 bg-slate-50 px-3 py-2">
                        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Confirm coverage level</p>
                        <div className="flex flex-wrap gap-1.5">
                          {(["CONFIRM_FULL", "CONFIRM_SUBSTANTIAL", "MARK_NA"] as CoverageActionType[]).map((action) => {
                            const key = `${row.id}:${action}`;
                            const state = coverageActionStates[key];
                            if (state?.success) {
                              return <span key={action} className="inline-flex items-center gap-0.5 text-[10px] text-green-700 font-medium">{state.success} <CheckIcon /></span>;
                            }
                            return (
                              <button
                                key={action}
                                type="button"
                                disabled={state?.pending}
                                onClick={() => {
                                  if (action === "MARK_NA") {
                                    setNaReasonPrompt({ requirementId: row.id, title: row.title });
                                    setNaReasonValue("");
                                  } else {
                                    void applyCoverageAction(row.id, action);
                                  }
                                }}
                                className={`rounded px-2 py-0.5 text-[10px] font-medium disabled:opacity-60 ${
                                  action === "CONFIRM_FULL"
                                    ? "bg-green-100 text-green-800 hover:bg-green-200"
                                    : action === "CONFIRM_SUBSTANTIAL"
                                    ? "bg-blue-100 text-blue-800 hover:bg-blue-200"
                                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                }`}
                              >
                                {state?.pending ? "…" : action === "CONFIRM_FULL" ? "Confirm FULL" : action === "CONFIRM_SUBSTANTIAL" ? "Confirm SUBSTANTIAL" : "Mark N/A"}
                              </button>
                            );
                          })}
                          {Object.entries(coverageActionStates)
                            .filter(([k]) => k.startsWith(`${row.id}:`))
                            .map(([k, s]) => s.error ? <span key={k} className="text-[10px] text-red-600">{s.error}</span> : null)}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* N/A reason inline prompt */}
      {naReasonPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="na-dialog-title" className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h4 id="na-dialog-title" className="mb-2 text-sm font-semibold text-gray-900">Mark as Not Applicable</h4>
            <p className="mb-3 text-xs text-gray-600">Requirement: <strong>{naReasonPrompt.title}</strong></p>
            <label className="mb-1 block text-xs font-medium text-gray-700">Reason (required)</label>
            <textarea
              value={naReasonValue}
              onChange={(e) => setNaReasonValue(e.target.value)}
              rows={3}
              className="w-full rounded border border-gray-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
              placeholder="e.g. This requirement is covered by a separate compliance attestation outside this tender scope."
              autoFocus
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setNaReasonPrompt(null); setNaReasonValue(""); }}
                className="rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!naReasonValue.trim()}
                onClick={() => {
                  const { requirementId } = naReasonPrompt;
                  setNaReasonPrompt(null);
                  void applyCoverageAction(requirementId, "MARK_NA", naReasonValue.trim());
                }}
                className="rounded bg-gray-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-60"
              >
                Confirm N/A
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
