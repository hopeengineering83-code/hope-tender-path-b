"use client";

import { useState, useEffect, useCallback } from "react";

type SupportLevel = "FULL" | "SUBSTANTIAL" | "PARTIAL" | "NONE" | "NOT_APPLICABLE";

type EvidenceLink = {
  id: string;
  evidenceType: string;
  evidenceSource: string;
  evidenceReference: string | null;
  supportLevel: string;
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

export default function RequirementCoveragePanel({ tenderId }: { tenderId: string }) {
  const [data, setData] = useState<CoverageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<"ALL" | "UNCOVERED" | "PARTIAL" | "COVERED">("UNCOVERED");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

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
        <div className="flex items-center gap-2">
          <button onClick={load} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100" aria-label="Refresh coverage">↻</button>
          <button onClick={() => setExpanded((v) => !v)} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100">
            {expanded ? "▲ Collapse" : "▼ Show requirements"}
          </button>
        </div>
      </div>

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
                              "{row.sourceExactQuote.slice(0, 200)}{row.sourceExactQuote.length > 200 ? "…" : ""}"
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
                        <ul className="space-y-1">
                          {row.evidenceLinks.map((link) => {
                            const lCfg = SUPPORT_LEVEL_CONFIG[link.supportLevel as SupportLevel] ?? SUPPORT_LEVEL_CONFIG.PARTIAL;
                            return (
                              <li key={link.id} className="flex items-center gap-2 text-xs text-gray-700">
                                <span className={`h-2 w-2 shrink-0 rounded-full ${lCfg.dot}`} />
                                <span className="font-medium">{link.evidenceType}</span>
                                <span className="text-gray-500">—</span>
                                <span className="truncate">{link.evidenceSource}</span>
                                {link.evidenceReference && <span className="text-gray-400 shrink-0">({link.evidenceReference})</span>}
                                <span className={`shrink-0 rounded border px-1 py-0.5 text-xs ${lCfg.color}`}>{link.supportLevel}</span>
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
