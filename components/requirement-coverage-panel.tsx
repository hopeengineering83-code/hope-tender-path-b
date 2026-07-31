"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, ChevronDownIcon, RefreshIcon, WarningIcon } from "./icons";

type SupportLevel = "FULL" | "SUBSTANTIAL" | "PARTIAL" | "NONE" | "NOT_APPLICABLE";
type CoverageStatus = "FULLY_MET" | "PARTIALLY_MET" | "NOT_MET" | "NEEDS_TRACE";
type AutomationState = "COVERED" | "PARTIAL" | "SOURCE_PROCESSING" | "TRUE_EVIDENCE_GAP";
type CoverageFilter = "ALL" | "PENDING" | "PARTIAL" | "COVERED";

type EvidenceLink = {
  id: string;
  evidenceType: string;
  evidenceSource: string;
  evidenceReference: string | null;
  supportLevel: string;
  autoLinked: boolean;
  linkageScore: number | null;
  linkageReasons: string[];
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
  automationState: AutomationState;
  nextAction: string;
};

type CoverageData = {
  ok: true;
  automatic: true;
  manualConfirmationRequired: false;
  totalMandatory: number;
  fullyCovered: number;
  partiallyCovered: number;
  needsTrace: number;
  uncovered: number;
  missingSourceRef: number;
  automaticallyLinked: number;
  trueEvidenceGaps: number;
  sourceProcessing: number;
  coverageRatio: number;
  rows: RequirementCoverageRow[];
};

type SyncResult = {
  ok?: boolean;
  error?: string;
  sourceRepair?: { repairedCount?: number; remainingCount?: number };
  created?: number;
  updated?: number;
  removedStale?: number;
  unchanged?: number;
  desiredLinks?: number;
};

type TraceabilitySummary = {
  requirements: number;
  weakRequirements: number;
  selectedExpertsWithWeakEvidence: number;
  selectedProjectsWithWeakEvidence: number;
};

const SUPPORT_LEVEL_CONFIG: Record<SupportLevel, { label: string; color: string; dot: string }> = {
  FULL: { label: "Full", color: "border-green-300 bg-green-100 text-green-800", dot: "bg-green-500" },
  SUBSTANTIAL: { label: "Substantial", color: "border-blue-300 bg-blue-100 text-blue-800", dot: "bg-blue-500" },
  PARTIAL: { label: "Partial", color: "border-amber-300 bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  NONE: { label: "Pending", color: "border-slate-300 bg-slate-100 text-slate-700", dot: "bg-slate-400" },
  NOT_APPLICABLE: { label: "N/A", color: "border-gray-300 bg-gray-100 text-gray-600", dot: "bg-gray-400" },
};

const AUTOMATION_STATE_CONFIG: Record<AutomationState, { label: string; color: string; dot: string }> = {
  COVERED: { label: "Covered", color: "border-green-300 bg-green-100 text-green-800", dot: "bg-green-500" },
  PARTIAL: { label: "Auto-linked partial", color: "border-amber-300 bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  SOURCE_PROCESSING: { label: "Auto-grounding", color: "border-orange-300 bg-orange-100 text-orange-800", dot: "bg-orange-500" },
  TRUE_EVIDENCE_GAP: { label: "Evidence unavailable", color: "border-red-300 bg-red-100 text-red-800", dot: "bg-red-500" },
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

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

export default function RequirementCoveragePanel({ tenderId }: { tenderId: string; canMutate?: boolean }) {
  const router = useRouter();
  const serverPanelsRefreshed = useRef(false);
  const hasLoaded = useRef(false);
  const [data, setData] = useState<CoverageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [synchronizing, setSynchronizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<CoverageFilter>("PENDING");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [traceability, setTraceability] = useState<{ summary: TraceabilitySummary; warnings: string[] } | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);

  const syncAndLoad = useCallback(async () => {
    setLoading(!hasLoaded.current);
    setSynchronizing(true);
    setError(null);
    setSyncWarning(null);

    let changed = 0;
    try {
      const syncResponse = await fetch(`/api/tenders/${tenderId}/requirement-coverage/auto-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const syncJson = await readJson(syncResponse) as SyncResult;
      if (!syncResponse.ok || !syncJson.ok) {
        setSyncWarning(typeof syncJson.error === "string"
          ? syncJson.error
          : "Automatic coverage synchronization is retrying in the background.");
      } else {
        changed = Number(syncJson.created ?? 0)
          + Number(syncJson.updated ?? 0)
          + Number(syncJson.removedStale ?? 0)
          + Number(syncJson.sourceRepair?.repairedCount ?? 0);
      }
    } catch {
      setSyncWarning("Automatic coverage synchronization is retrying in the background.");
    } finally {
      setSynchronizing(false);
    }

    try {
      const response = await fetch(`/api/tenders/${tenderId}/requirement-coverage`, { cache: "no-store" });
      const json = await readJson(response);
      if (!response.ok || json.ok !== true) {
        throw new Error(typeof json.error === "string" ? json.error : "Failed to load coverage");
      }
      setData(json as unknown as CoverageData);
      if (changed > 0 && !serverPanelsRefreshed.current) {
        serverPanelsRefreshed.current = true;
        router.refresh();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load coverage");
    } finally {
      hasLoaded.current = true;
      setLoading(false);
    }
  }, [router, tenderId]);

  useEffect(() => {
    void syncAndLoad();
  }, [syncAndLoad]);

  const toggleRow = (id: string) => {
    setExpandedRows((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const loadTraceability = async () => {
    if (traceOpen && traceability) {
      setTraceOpen(false);
      return;
    }
    setTraceOpen(true);
    if (traceability) return;
    setTraceLoading(true);
    try {
      const response = await fetch(`/api/tenders/${tenderId}/traceability`, { cache: "no-store" });
      const json = await readJson(response) as {
        success?: boolean;
        traceability?: { summary: TraceabilitySummary; warnings: string[] };
      };
      if (response.ok && json.success && json.traceability) {
        setTraceability({
          summary: json.traceability.summary,
          warnings: (json.traceability.warnings ?? []).filter(Boolean),
        });
      }
    } finally {
      setTraceLoading(false);
    }
  };

  if (loading) {
    return (
      <div id="requirement-coverage" className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-gray-600">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" aria-hidden="true" />
          Automatically grounding requirements and linking eligible evidence…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div id="requirement-coverage" className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">{error ?? "Unable to load requirement coverage."}</p>
        <button type="button" onClick={() => void syncAndLoad()} className="mt-2 text-xs text-red-700 underline">
          Retry automatic synchronization
        </button>
      </div>
    );
  }

  if (data.totalMandatory === 0) {
    return (
      <div id="requirement-coverage" className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm text-gray-600">No mandatory requirements are available yet. Analysis and extraction continue automatically.</p>
      </div>
    );
  }

  const coveragePct = Math.round(data.coverageRatio * 100);
  const filteredRows = data.rows.filter((row) => {
    if (filter === "PENDING") return row.automationState === "SOURCE_PROCESSING" || row.automationState === "TRUE_EVIDENCE_GAP";
    if (filter === "PARTIAL") return row.automationState === "PARTIAL";
    if (filter === "COVERED") return row.automationState === "COVERED";
    return true;
  });

  return (
    <div id="requirement-coverage" className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-3">
        <div className="flex flex-wrap items-center gap-3">
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
          <button
            type="button"
            onClick={() => void syncAndLoad()}
            disabled={synchronizing}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-60"
            aria-label="Synchronize automatic requirement coverage"
            title="Synchronize automatic requirement coverage"
          >
            <RefreshIcon className={synchronizing ? "animate-spin" : ""} />
            {synchronizing ? "Synchronizing" : "Synchronize"}
          </button>
          <button
            type="button"
            onClick={() => void loadTraceability()}
            disabled={traceLoading}
            aria-expanded={traceOpen}
            aria-controls="traceability-panel"
            className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-60"
          >
            {traceLoading ? "Loading…" : <><ChevronDownIcon className={traceOpen ? "inline h-3 w-3 rotate-180" : "inline h-3 w-3"} /> Traceability</>}
          </button>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-controls="req-coverage-list"
            className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
          >
            {expanded ? <><ChevronDownIcon className="rotate-180" /> Collapse</> : <><ChevronDownIcon /> Show requirements</>}
          </button>
        </div>
      </div>

      <div className="border-b border-blue-100 bg-blue-50 px-5 py-2 text-xs text-blue-800">
        Requirement grounding and evidence linking are automatic. Only persisted, current, source-grounded links count toward release; no confirmation click is required.
      </div>

      {syncWarning && (
        <div role="status" aria-live="polite" className="flex items-start gap-1 border-b border-amber-100 bg-amber-50 px-5 py-2 text-xs text-amber-800">
          <WarningIcon className="mt-0.5 shrink-0" />
          <span>{syncWarning} Existing release gates remain fail-closed.</span>
        </div>
      )}

      {traceOpen && traceability && (
        <div id="traceability-panel" className="border-b border-gray-100 bg-amber-50 px-5 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-800">Traceability Audit</p>
          <div className="grid grid-cols-2 gap-3 text-center text-xs sm:grid-cols-4">
            <div><div className="text-base font-bold text-gray-800">{traceability.summary.requirements}</div><div className="text-gray-600">Requirements</div></div>
            <div><div className={`text-base font-bold ${traceability.summary.weakRequirements > 0 ? "text-red-700" : "text-green-700"}`}>{traceability.summary.weakRequirements}</div><div className="text-gray-600">Weak source</div></div>
            <div><div className={`text-base font-bold ${traceability.summary.selectedExpertsWithWeakEvidence > 0 ? "text-amber-700" : "text-green-700"}`}>{traceability.summary.selectedExpertsWithWeakEvidence}</div><div className="text-gray-600">Weak experts</div></div>
            <div><div className={`text-base font-bold ${traceability.summary.selectedProjectsWithWeakEvidence > 0 ? "text-amber-700" : "text-green-700"}`}>{traceability.summary.selectedProjectsWithWeakEvidence}</div><div className="text-gray-600">Weak projects</div></div>
          </div>
          {traceability.warnings.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-xs text-amber-800">
              {traceability.warnings.map((warning) => <li key={warning} className="flex items-start gap-1"><WarningIcon className="mt-0.5 shrink-0" /><span>{warning}</span></li>)}
            </ul>
          ) : (
            <p className="mt-2 flex items-center gap-1 text-xs text-green-700"><CheckIcon /> Current traceability checks pass.</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-px border-b border-gray-100 bg-gray-100 text-center text-xs sm:grid-cols-6">
        {[
          { label: "Mandatory", value: data.totalMandatory, color: "text-gray-800" },
          { label: "Source grounded", value: data.totalMandatory - data.missingSourceRef, color: "text-blue-700" },
          { label: "Auto links", value: data.automaticallyLinked, color: "text-blue-700" },
          { label: "Covered", value: data.fullyCovered, color: "text-green-700" },
          { label: "Partial", value: data.partiallyCovered, color: "text-amber-800" },
          { label: "True gaps", value: data.trueEvidenceGaps, color: data.trueEvidenceGaps > 0 ? "text-red-700" : "text-gray-500" },
        ].map((cell) => (
          <div key={cell.label} className="bg-white py-2">
            <div className={`text-base font-bold ${cell.color}`}>{cell.value}</div>
            <div className="text-gray-600">{cell.label}</div>
          </div>
        ))}
      </div>

      {data.sourceProcessing > 0 && (
        <div role="status" aria-live="polite" className="flex items-start gap-1 border-b border-orange-100 bg-orange-50 px-5 py-2 text-xs text-orange-800">
          <RefreshIcon className="mt-0.5 shrink-0 animate-spin" />
          <span>{data.sourceProcessing} requirement source trace(s) are being repaired automatically against active tender files. Final release remains blocked until exact quote and page provenance are proven.</span>
        </div>
      )}

      {expanded && (
        <div id="req-coverage-list" className="divide-y divide-gray-100">
          <div className="flex flex-wrap gap-1 px-5 py-2">
            {(["ALL", "PENDING", "PARTIAL", "COVERED"] as CoverageFilter[]).map((value) => {
              const count = value === "ALL"
                ? data.rows.length
                : value === "PENDING"
                  ? data.sourceProcessing + data.trueEvidenceGaps
                  : value === "PARTIAL"
                    ? data.partiallyCovered
                    : data.fullyCovered;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${filter === value ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                >
                  {value === "PENDING" ? "Automatic work" : value[0] + value.slice(1).toLowerCase()} ({count})
                </button>
              );
            })}
          </div>

          {filteredRows.length === 0 && (
            <div className="px-5 py-4 text-sm text-gray-600">No requirements match this filter.</div>
          )}

          {filteredRows.map((row) => {
            const stateConfig = AUTOMATION_STATE_CONFIG[row.automationState];
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
                  <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${stateConfig.dot}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{row.title}</span>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{REQ_TYPE_LABELS[row.requirementType] ?? row.requirementType}</span>
                      <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${stateConfig.color}`}>{stateConfig.label}</span>
                      {!row.hasSourceRef && (
                        <span className="rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-xs text-orange-800">Source grounding</span>
                      )}
                    </div>
                    {!isOpen && <p className="mt-0.5 text-xs text-gray-600">{row.nextAction}</p>}
                  </div>
                  <span className="shrink-0 text-gray-500"><ChevronDownIcon className={isOpen ? "rotate-180" : ""} /></span>
                </button>

                {isOpen && (
                  <div id={`req-row-${row.id}`} className="ml-5 mt-2 space-y-3">
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-600">Tender source grounding</p>
                      {row.hasSourceRef ? (
                        <div className="space-y-0.5 text-xs text-gray-700">
                          {row.sectionReference && <div>Section: {row.sectionReference}</div>}
                          {row.sourcePageNumber && <div>Page: {row.sourcePageNumber}</div>}
                          {row.sourceSectionHeading && <div>Heading: {row.sourceSectionHeading}</div>}
                          {row.sourceExactQuote && (
                            <blockquote className="mt-1 border-l-2 border-gray-300 pl-2 text-gray-700 italic">
                              &ldquo;{row.sourceExactQuote.slice(0, 200)}{row.sourceExactQuote.length > 200 ? "…" : ""}&rdquo;
                            </blockquote>
                          )}
                          <span className="inline-flex items-center rounded border border-blue-200 bg-blue-50 px-1 py-0.5 text-[10px] font-medium text-blue-700">
                            {Math.round((row.sourceConfidence ?? 0) * 100)}% grounding confidence
                          </span>
                        </div>
                      ) : (
                        <p role="status" className="flex items-start gap-1 text-xs text-orange-800"><RefreshIcon className="mt-0.5 shrink-0 animate-spin" /><span>Automatic source grounding is processing the active tender files. No manual source-reference entry is requested.</span></p>
                      )}
                    </div>

                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-600">Persisted evidence links ({row.evidenceLinks.length})</p>
                      {row.evidenceLinks.length === 0 ? (
                        <p className={`text-xs ${row.automationState === "TRUE_EVIDENCE_GAP" ? "text-red-700" : "text-orange-800"}`}>
                          {row.automationState === "TRUE_EVIDENCE_GAP"
                            ? "No eligible source-verified evidence currently exists. Add the actual missing source document to Company Vault; ingestion, verification, matching, and linking continue automatically."
                            : "Automatic evidence selection is waiting for source grounding or dependent generated bytes."}
                        </p>
                      ) : (
                        <ul className="space-y-1.5">
                          {row.evidenceLinks.map((link) => {
                            const support = SUPPORT_LEVEL_CONFIG[link.supportLevel as SupportLevel] ?? SUPPORT_LEVEL_CONFIG.PARTIAL;
                            return (
                              <li key={link.id} className="rounded border border-gray-100 bg-gray-50 px-2 py-1.5">
                                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-700">
                                  <span className={`h-2 w-2 shrink-0 rounded-full ${support.dot}`} aria-hidden="true" />
                                  <span className="font-medium">{link.evidenceType}</span>
                                  {link.evidenceReference && <span className="min-w-0 break-all text-gray-600">{link.evidenceReference}</span>}
                                  <span className={`rounded border px-1 py-0.5 text-[10px] ${support.color}`}>{support.label}</span>
                                  {link.autoLinked && <span className="rounded bg-blue-100 px-1 py-0.5 text-[10px] font-medium text-blue-700">Automatically linked</span>}
                                  {typeof link.linkageScore === "number" && <span className="text-[10px] text-gray-600">{Math.round(link.linkageScore)}% fit</span>}
                                </div>
                                {link.linkageReasons.length > 0 && (
                                  <p className="mt-1 text-[10px] text-gray-600">{link.linkageReasons.join(" · ")}</p>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>

                    <div className="rounded border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                      <span className="font-medium">Automatic next step: </span>{row.nextAction}
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
