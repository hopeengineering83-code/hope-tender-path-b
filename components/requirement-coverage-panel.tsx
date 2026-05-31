"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

type SupportLevel = "FULL" | "SUBSTANTIAL" | "PARTIAL" | "NONE" | "NOT_APPLICABLE";

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
  isFullyCovered: boolean;
  nextAction: string;
};

type CoverageData = {
  totalMandatory: number;
  fullyCovered: number;
  partiallyCovered: number;
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

type TraceabilitySummary = {
  requirements: number;
  weakRequirements: number;
  selectedExpertsWithWeakEvidence: number;
  selectedProjectsWithWeakEvidence: number;
};

export default function RequirementCoveragePanel({ tenderId }: { tenderId: string }) {
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
          supportLevel: "FULL",
          notes: "Confirmed auto-linked vault evidence by reviewer.",
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
    } catch {
      setLinkAction(key, { pending: false, error: "Network error", success: null });
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
    } catch {
      setLinkAction(key, { pending: false, error: "Network error", success: null });
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
          body: JSON.stringify({ requirementId, evidenceType: link.evidenceType, evidenceReference: link.evidenceReference, supportLevel: "FULL", notes: "Bulk-confirmed auto-linked vault evidence." }),
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

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          Loading mandatory requirement coverage…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">{error ?? "Unable to load requirement coverage."}</p>
        <button onClick={load} className="mt-2 text-xs text-red-600 underline">Retry</button>
      </div>
    );
  }

  if (data.totalMandatory === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm text-gray-500">No mandatory requirements found. Run AI Analyze or Run Engine to extract requirements.</p>
      </div>
    );
  }

  const coveragePct = Math.round(data.coverageRatio * 100);
  const filteredRows = data.rows.filter((r) => {
    if (filter === "UNCOVERED") return r.supportLevel === "NONE";
    if (filter === "PARTIAL") return r.supportLevel === "PARTIAL" || r.supportLevel === "SUBSTANTIAL";
    if (filter === "COVERED") return r.isFullyCovered;
    return true;
  });

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
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
            <span className={`text-xs font-semibold ${coveragePct >= 80 ? "text-green-700" : coveragePct >= 50 ? "text-amber-700" : "text-red-700"}`}>
              {coveragePct}%
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={load} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100" aria-label="Refresh coverage">↻</button>
          {data && data.rows.some((r) => r.evidenceLinks.some((l) => l.autoLinked && !actionStates[`${r.id}-${l.id}`]?.success)) && (
            <button
              onClick={() => void confirmAllSafe()}
              disabled={confirmingAll}
              className="rounded border border-green-300 bg-green-50 px-2 py-1 text-xs font-medium text-green-800 hover:bg-green-100 disabled:opacity-50"
            >
              {confirmingAll ? "Confirming…" : "Confirm all auto-linked"}
            </button>
          )}
          <button onClick={() => void loadTraceability()} disabled={traceLoading} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-50">
            {traceLoading ? "…" : traceOpen ? "▲ Traceability" : "▼ Traceability"}
          </button>
          <button onClick={() => setExpanded((v) => !v)} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100">
            {expanded ? "▲ Collapse" : "▼ Show requirements"}
          </button>
        </div>
      </div>

      {confirmAllResult && (
        <div className="border-b border-green-100 bg-green-50 px-5 py-2 text-xs text-green-800">{confirmAllResult}</div>
      )}

      {/* Traceability summary */}
      {traceOpen && traceability && (
        <div className="border-b border-gray-100 px-5 py-3 bg-amber-50">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-2">Traceability Audit</p>
          <div className="grid grid-cols-4 gap-3 text-xs text-center">
            <div><div className="text-base font-bold text-gray-800">{traceability.summary.requirements}</div><div className="text-gray-500">Requirements</div></div>
            <div><div className={`text-base font-bold ${traceability.summary.weakRequirements > 0 ? "text-red-600" : "text-green-600"}`}>{traceability.summary.weakRequirements}</div><div className="text-gray-500">Weak source</div></div>
            <div><div className={`text-base font-bold ${traceability.summary.selectedExpertsWithWeakEvidence > 0 ? "text-amber-600" : "text-green-600"}`}>{traceability.summary.selectedExpertsWithWeakEvidence}</div><div className="text-gray-500">Weak experts</div></div>
            <div><div className={`text-base font-bold ${traceability.summary.selectedProjectsWithWeakEvidence > 0 ? "text-amber-600" : "text-green-600"}`}>{traceability.summary.selectedProjectsWithWeakEvidence}</div><div className="text-gray-500">Weak projects</div></div>
          </div>
          {traceability.warnings.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-amber-800">
              {traceability.warnings.map((w) => <li key={w}>⚠ {w}</li>)}
            </ul>
          )}
          {traceability.warnings.length === 0 && (
            <p className="mt-2 text-xs text-green-700">All requirements and selected evidence have acceptable traceability.</p>
          )}
        </div>
      )}

      {/* Summary bar */}
      <div className="grid grid-cols-4 gap-px border-b border-gray-100 bg-gray-100 text-center text-xs">
        {[
          { label: "Mandatory", value: data.totalMandatory, color: "text-gray-800" },
          { label: "Covered", value: data.fullyCovered, color: "text-green-700" },
          { label: "Partial", value: data.partiallyCovered, color: "text-amber-700" },
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
        <div className="border-b border-amber-100 bg-amber-50 px-5 py-2 text-xs text-amber-800">
          ⚠ {data.missingSourceRef} mandatory requirement(s) lack source page/quote traceability — export may be blocked.
        </div>
      )}

      {/* Requirement list */}
      {expanded && (
        <div className="divide-y divide-gray-100">
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
            const cfg = SUPPORT_LEVEL_CONFIG[row.supportLevel] ?? SUPPORT_LEVEL_CONFIG.NONE;
            const isOpen = expandedRows.has(row.id);
            return (
              <div key={row.id} className="px-5 py-3">
                <button
                  onClick={() => toggleRow(row.id)}
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
                        <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
                          No source ref
                        </span>
                      )}
                    </div>
                    {!isOpen && (
                      <p className="mt-0.5 text-xs text-gray-500">{row.nextAction}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-gray-400">{isOpen ? "▲" : "▼"}</span>
                </button>

                {isOpen && (
                  <div className="ml-5 mt-2 space-y-3">
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
                          <div className="text-gray-400">Confidence: {Math.round(row.sourceConfidence * 100)}%</div>
                        </div>
                      ) : (
                        <p className="text-xs text-amber-700">⚠ No source reference recorded. Run source extraction or add manually.</p>
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
                                      <span className="text-[10px] text-green-700 font-medium">{confirmState.success} ✓</span>
                                    ) : rejectState?.success ? (
                                      <span className="text-[10px] text-red-700 font-medium">{rejectState.success}</span>
                                    ) : (
                                      <>
                                        <button
                                          onClick={() => void confirmEvidence(row.id, link)}
                                          disabled={confirmState?.pending || rejectState?.pending}
                                          className="rounded bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800 hover:bg-green-200 disabled:opacity-50"
                                        >
                                          {confirmState?.pending ? "…" : "✓ Confirm evidence"}
                                        </button>
                                        <button
                                          onClick={() => void rejectEvidence(row.id, link)}
                                          disabled={confirmState?.pending || rejectState?.pending}
                                          className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 hover:bg-red-200 disabled:opacity-50"
                                        >
                                          {rejectState?.pending ? "…" : "✗ Not applicable"}
                                        </button>
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
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
