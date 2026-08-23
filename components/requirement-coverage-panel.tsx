"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDownIcon, WarningIcon } from "./icons";
import { humanizeEnumValue } from "../lib/ui/human-labels";

type SupportLevel = "FULL" | "SUBSTANTIAL" | "PARTIAL" | "NONE" | "NOT_APPLICABLE";
type CoverageStatus = "FULLY_MET" | "PARTIALLY_MET" | "NOT_MET" | "NEEDS_TRACE";
type AutomationState =
  | "FULLY_VERIFIED"
  | "PARTIALLY_VERIFIED"
  | "AUTO_RESOLVING"
  | "TRUE_EVIDENCE_GAP"
  | "STALE_OR_INVALIDATED"
  // Package RULES — financial separation, single-file consolidation, file
  // format, file naming. These are obeyed or broken by the submission the app
  // produces. They are never evidence gaps and must never be shown as a
  // request for the owner to supply or strengthen evidence.
  | "ENFORCED_BY_PACKAGE"
  | "PACKAGE_RULE_VIOLATION";
type CoverageFilter = "ALL" | "UNRESOLVED" | "PARTIAL" | "COVERED";

type EvidenceLink = {
  id: string;
  evidenceType: string;
  evidenceSource: string;
  evidenceReference: string | null;
  supportLevel: string;
  autoLinked: boolean;
  linkageScore: number | null;
  linkageReasons: string[];
  sourceDocumentId: string | null;
  sourceFileName: string | null;
  sourceContentHash: string | null;
  sourceByteLength: number | null;
  matchedFacets: string[];
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
  packageRuleViolations: number;
  packageEnforcedRules: number;
  sourceProcessing: number;
  staleOrInvalidated: number;
  coverageRatio: number;
  weightedProgressRatio: number;
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

const SUPPORT_LEVEL_CONFIG: Record<SupportLevel, { label: string; color: string; dot: string }> = {
  FULL: { label: "Full", color: "border-green-300 bg-green-100 text-green-800", dot: "bg-green-500" },
  SUBSTANTIAL: { label: "Substantial", color: "border-blue-300 bg-blue-100 text-blue-800", dot: "bg-blue-500" },
  PARTIAL: { label: "Partial", color: "border-amber-300 bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  NONE: { label: "Pending", color: "border-slate-300 bg-slate-100 text-slate-700", dot: "bg-slate-400" },
  NOT_APPLICABLE: { label: "N/A", color: "border-gray-300 bg-gray-100 text-gray-600", dot: "bg-gray-400" },
};

const AUTOMATION_STATE_CONFIG: Record<AutomationState, { label: string; color: string; dot: string }> = {
  FULLY_VERIFIED: { label: "Fully verified", color: "border-green-300 bg-green-100 text-green-800", dot: "bg-green-500" },
  PARTIALLY_VERIFIED: { label: "Partially verified", color: "border-amber-300 bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  AUTO_RESOLVING: { label: "Auto-resolving", color: "border-orange-300 bg-orange-100 text-orange-800", dot: "bg-orange-500" },
  TRUE_EVIDENCE_GAP: { label: "Genuine gap", color: "border-red-300 bg-red-100 text-red-800", dot: "bg-red-500" },
  ENFORCED_BY_PACKAGE: { label: "Enforced by the package", color: "border-sky-300 bg-sky-100 text-sky-800", dot: "bg-sky-500" },
  PACKAGE_RULE_VIOLATION: { label: "Package rule broken", color: "border-red-300 bg-red-100 text-red-800", dot: "bg-red-500" },
  STALE_OR_INVALIDATED: { label: "Stale or invalidated", color: "border-slate-300 bg-slate-100 text-slate-800", dot: "bg-slate-500" },
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
  // FORMAT and SCHEDULE are in the requirementType contract the analyzer emits
  // (see the enumeration in lib/ai.ts) but were missing here, so a FORMAT
  // requirement rendered as raw "FORMAT" next to "Form" and "Submission".
  FORMAT: "Format",
  SCHEDULE: "Schedule",
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

export default function RequirementCoveragePanel({ tenderId }: { tenderId: string; canMutate?: boolean }) {
  const hasLoaded = useRef(false);
  const [data, setData] = useState<CoverageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<CoverageFilter>("UNRESOLVED");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const loadCoverage = useCallback(async () => {
    setLoading(!hasLoaded.current);
    setError(null);
    setSyncWarning(null);

    try {
      const response = await fetch(`/api/tenders/${tenderId}/requirement-coverage`, { cache: "no-store" });
      const json = await readJson(response);
      if (!response.ok || json.ok !== true) {
        throw new Error(typeof json.error === "string" ? json.error : "Failed to load coverage");
      }
      setData(json as unknown as CoverageData);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load coverage");
    } finally {
      hasLoaded.current = true;
      setLoading(false);
    }
  }, [tenderId]);

  const requestRecovery = useCallback(async () => {
    try {
      const response = await fetch(`/api/tenders/${tenderId}/requirement-coverage/auto-sync`, { method: "POST" });
      const json = await readJson(response) as SyncResult;
      if (!response.ok || !json.ok) setSyncWarning(json.error ?? "Recovery could not be queued.");
      await loadCoverage();
    } catch {
      setSyncWarning("Recovery could not be queued. Existing release gates remain fail-closed.");
    }
  }, [loadCoverage, tenderId]);

  useEffect(() => {
    void loadCoverage();
  }, [loadCoverage]);

  const toggleRow = (id: string) => {
    setExpandedRows((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div id="requirement-coverage" className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-gray-600">
          Automatic verification running.
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div id="requirement-coverage" className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">{error ?? "Unable to load requirement coverage."}</p>
        <button type="button" onClick={() => void requestRecovery()} className="mt-2 text-xs text-red-700 underline">
          Request recovery
        </button>
      </div>
    );
  }

  if (data.totalMandatory === 0) {
    return (
      <div id="requirement-coverage" className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm font-semibold text-gray-800">Requirements and Evidence</p>
        <p className="mt-1 text-sm text-gray-600">
          {data.sourceProcessing > 0
            ? "Durable requirement resolution is queued or running."
            : "No mandatory or critical requirements are available for evidence resolution."}
        </p>
      </div>
    );
  }

  const coveragePct = Math.round(data.coverageRatio * 100);
  const progressPct = Math.round(data.weightedProgressRatio * 100);
  // One definition of "unresolved", shared by the stat tile, the filter chip
  // and the filter predicate, so the three can never disagree.
  // A broken package rule is genuinely unresolved and blocks release, so it is
  // counted here. An ENFORCED_BY_PACKAGE row is not: nothing is being asked of
  // the owner, and counting it as a gap is exactly what this panel used to do
  // wrong.
  const unresolvedCount = data.trueEvidenceGaps + data.staleOrInvalidated + (data.packageRuleViolations ?? 0);

  const filteredRows = data.rows.filter((row) => {
    if (filter === "UNRESOLVED") {
      return row.automationState === "TRUE_EVIDENCE_GAP"
        || row.automationState === "STALE_OR_INVALIDATED"
        || row.automationState === "PACKAGE_RULE_VIOLATION";
    }
    if (filter === "PARTIAL") return row.automationState === "PARTIALLY_VERIFIED";
    if (filter === "COVERED") return row.automationState === "FULLY_VERIFIED";
    return true;
  });

  return (
    <div id="requirement-coverage" className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-gray-800">Requirements and Evidence</span>
          <div className="flex items-center gap-2">
            <div className="h-2 w-24 overflow-hidden rounded-full bg-gray-200">
              <div
                className={`h-full rounded-full transition-all ${coveragePct >= 80 ? "bg-green-500" : coveragePct >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                style={{ width: `${coveragePct}%` }}
              />
            </div>
            <span className={`text-xs font-semibold ${coveragePct >= 80 ? "text-green-700" : coveragePct >= 50 ? "text-amber-800" : "text-red-700"}`}>
              Release-qualified coverage: {data.fullyCovered}/{data.totalMandatory} ({coveragePct}%)
            </span>
            <span className="text-xs font-medium text-slate-600">Progress including partial evidence: {progressPct}%</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
        {data.trueEvidenceGaps === 0 && data.sourceProcessing === 0 && data.partiallyCovered === 0 && (data.packageRuleViolations ?? 0) === 0
          ? "Verified and ready. Only persisted, current, source-grounded links count toward release; no confirmation click is required."
          : coveragePct > 0
            ? data.sourceProcessing > 0
              ? "Partially verified. Durable automatic resolution is running; release stays fail-closed until every required provenance check passes."
              : data.partiallyCovered > 0 && data.trueEvidenceGaps === 0 && data.staleOrInvalidated === 0
                ? `Partial evidence exists for ${data.partiallyCovered} requirement(s), but it is not release-qualified. Strengthen it with eligible source-backed evidence; release remains blocked.`
                : "Partially verified. Genuine evidence gaps or stale evidence remain; release stays fail-closed until they are resolved."
            : data.sourceProcessing > 0
              ? "Durable automatic resolution is running."
              : "No mandatory requirement is fully verified. No resolver job is queued or running; release remains fail-closed."}
      </div>

      {syncWarning && (
        <div role="status" aria-live="polite" className="flex items-start gap-1 border-b border-amber-100 bg-amber-50 px-5 py-2 text-xs text-amber-800">
          <WarningIcon className="mt-0.5 shrink-0" />
          <span>{syncWarning} Existing release gates remain fail-closed.</span>
        </div>
      )}


      <div className="grid grid-cols-2 gap-px border-b border-gray-100 bg-gray-100 text-center text-xs sm:grid-cols-4">
        {[
          { label: "Release-qualified", value: data.fullyCovered, color: "text-green-700" },
          { label: "Partial", value: data.partiallyCovered, color: "text-amber-800" },
          { label: "Automatic verification", value: data.sourceProcessing, color: "text-orange-700" },
          // Counts BOTH unresolved states, matching the filter chip below.
          // Naming this tile "Genuine gaps" while the chip counted genuine gaps
          // plus stale evidence meant the same words carried two numbers, and
          // the four tiles summed to fewer than the rows on screen.
          { label: "Genuine gaps / stale", value: unresolvedCount, color: unresolvedCount > 0 ? "text-red-700" : "text-gray-500" },
        ].map((cell) => (
          <div key={cell.label} className="bg-white py-2">
            <div className={`text-base font-bold ${cell.color}`}>{cell.value}</div>
            <div className="text-gray-600">{cell.label}</div>
          </div>
        ))}
      </div>

      {(data.packageEnforcedRules ?? 0) > 0 && (
        <div className="border-b border-sky-100 bg-sky-50 px-5 py-2 text-xs text-sky-800">
          {data.packageEnforcedRules} mandatory requirement(s) are submission RULES — financial separation, single-file
          consolidation, file format or file naming. They are verified by observing the package the app produces, not by
          any document you supply, so they are never counted as evidence gaps and never ask you for an upload.
        </div>
      )}

      {(data.packageRuleViolations ?? 0) > 0 && (
        <div role="status" aria-live="polite" className="border-b border-red-100 bg-red-50 px-5 py-2 text-xs text-red-800">
          {data.packageRuleViolations} submission rule(s) are broken by the current package. Release stays blocked. These
          are packaging defects to correct in the package itself — no evidence upload can resolve them.
        </div>
      )}

      {data.sourceProcessing > 0 && (
        <div role="status" aria-live="polite" className="flex items-start gap-1 border-b border-orange-100 bg-orange-50 px-5 py-2 text-xs text-orange-800">
          <span>Automatic source grounding is running for {data.sourceProcessing} requirement source trace(s). Final release remains blocked until exact quote and page provenance are proven.</span>
        </div>
      )}

      {expanded && (
        <div id="req-coverage-list" className="divide-y divide-gray-100">
          <div className="flex flex-wrap gap-1 px-5 py-2">
            {(["ALL", "UNRESOLVED", "PARTIAL", "COVERED"] as CoverageFilter[]).map((value) => {
              const count = value === "ALL"
                ? data.rows.length
                : value === "UNRESOLVED"
                  ? unresolvedCount
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
                  {value === "UNRESOLVED" ? "Genuine gaps / stale" : value[0] + value.slice(1).toLowerCase()} ({count})
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
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{REQ_TYPE_LABELS[row.requirementType] ?? humanizeEnumValue(row.requirementType)}</span>
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
                          {/*
                            sourceConfidence is the extractor's optional self-reported
                            score, stored as `req.sourceConfidence ?? 0` — so a model that
                            returns no score persists 0. Rendering that unconditionally put
                            "0% grounding confidence" directly beneath a verified file,
                            page, heading and exact quote, which reads as worthless
                            grounding when it only means "no score was supplied". The
                            grounding shown above is containment-verified and is the real
                            signal; the chip appears only when a score actually exists.
                          */}
                          {(row.sourceConfidence ?? 0) > 0 ? (
                            <span className="inline-flex items-center rounded border border-blue-200 bg-blue-50 px-1 py-0.5 text-[10px] font-medium text-blue-700">
                              {Math.round(row.sourceConfidence * 100)}% grounding confidence
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded border border-blue-200 bg-blue-50 px-1 py-0.5 text-[10px] font-medium text-blue-700">
                              Source-verified against the active tender file
                            </span>
                          )}
                        </div>
                      ) : (
                        <p role="status" className="text-xs text-orange-800">Automatic source grounding.</p>
                      )}
                    </div>

                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-600">
                        {row.automationState === "ENFORCED_BY_PACKAGE" || row.automationState === "PACKAGE_RULE_VIOLATION"
                          ? `Package observation (${row.evidenceLinks.length} persisted link${row.evidenceLinks.length === 1 ? "" : "s"})`
                          : `Persisted evidence links (${row.evidenceLinks.length})`}
                      </p>
                      {row.evidenceLinks.length === 0 ? (
                        <p className={`text-xs ${
                          row.automationState === "TRUE_EVIDENCE_GAP" || row.automationState === "PACKAGE_RULE_VIOLATION"
                            ? "text-red-700"
                            : row.automationState === "ENFORCED_BY_PACKAGE"
                              ? "text-sky-800"
                              : "text-orange-800"
                        }`}>
                          {/*
                            A package rule is answered by the submission, not by a
                            record. Telling the owner that "company-owned bytes do not
                            provide eligible evidence" for "Financial Proposal Omission"
                            asks for something that cannot exist. State what the package
                            shows instead — nextAction carries the observed verdict.
                          */}
                          {row.automationState === "PACKAGE_RULE_VIOLATION"
                            ? "This is a rule the submission must obey, and the current package breaks it. No evidence upload can fix it — the package must change."
                            : row.automationState === "ENFORCED_BY_PACKAGE"
                              ? "This is a rule the submission must obey, not a document to supply. It is verified by observing the produced package, so no evidence upload is expected."
                              : row.automationState === "TRUE_EVIDENCE_GAP"
                                ? "Automatic verification incomplete. Current company-owned bytes do not yet provide eligible evidence for this requirement."
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
                                  {link.sourceFileName && <span className="min-w-0 break-all text-gray-600">Source: {link.sourceFileName}</span>}
                                  <span className={`rounded border px-1 py-0.5 text-[10px] ${support.color}`}>{support.label}</span>
                                  {link.autoLinked && <span className="rounded bg-blue-100 px-1 py-0.5 text-[10px] font-medium text-blue-700">Automatically linked</span>}
                                  {typeof link.linkageScore === "number" && <span className="text-[10px] text-gray-600">Evidence relevance · {Math.round(link.linkageScore)}%</span>}
                                </div>
                                {link.linkageReasons.length > 0 && (
                                  <p className="mt-1 text-[10px] text-gray-600">{link.linkageReasons.join(" · ")}</p>
                                )}
                                {link.sourceContentHash && (
                                  <p className="mt-1 break-all font-mono text-[10px] text-gray-500">sha256:{link.sourceContentHash} · {link.sourceByteLength} bytes</p>
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
