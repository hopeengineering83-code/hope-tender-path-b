"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronDownIcon, RefreshIcon, WarningIcon, InfoIcon } from "./icons";

type DimensionCode =
  | "DISCIPLINE_FIT"
  | "SCOPE_COVERAGE"
  | "SENIORITY_OR_SCALE"
  | "SECTOR_FIT"
  | "ROLE_RECENCY"
  | "EVIDENCE_QUALITY"
  | "COMPLIANCE_CRITICALITY"
  | "PORTFOLIO_CONTRIBUTION"
  | "MANDATORY_ELIGIBILITY"
  | "DELIVERY_RISK"
  | "DIFFERENTIATION"
  | "COMMERCIAL_VALUE";

const DIMENSION_LABELS: Record<DimensionCode, string> = {
  DISCIPLINE_FIT:          "Discipline",
  SCOPE_COVERAGE:          "Scope",
  SENIORITY_OR_SCALE:      "Seniority/Scale",
  SECTOR_FIT:              "Sector",
  ROLE_RECENCY:            "Recency",
  EVIDENCE_QUALITY:        "Evidence",
  COMPLIANCE_CRITICALITY:  "Compliance",
  PORTFOLIO_CONTRIBUTION:  "Portfolio",
  MANDATORY_ELIGIBILITY:   "Eligibility",
  DELIVERY_RISK:           "Delivery risk",
  DIFFERENTIATION:         "Differentiation",
  COMMERCIAL_VALUE:        "Commercial",
};

type DimensionRow = {
  code: DimensionCode;
  score: number;
  weight: number;
  rationale: string | null;
  source: string;
};

type CorrectiveAction = {
  severity: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  action: string;
  dimension: DimensionCode;
  entity?: string;
  selected?: boolean;
};

type EntityBreakdown = {
  entityId: string;
  name: string;
  overallScore: number;
  matchScore: number;
  isSelected: boolean;
  dimensions: DimensionRow[];
  weakDimensions: DimensionCode[];
  correctiveActions?: CorrectiveAction[];
};

type BreakdownData = {
  experts: EntityBreakdown[];
  projects: EntityBreakdown[];
  hasDimensionData: boolean;
  dimensionOrder: DimensionCode[];
  correctiveActionSummary?: CorrectiveAction[];
};

function scoreColor(score: number): string {
  if (score >= 70) return "bg-green-500";
  if (score >= 40) return "bg-amber-400";
  return "bg-red-500";
}

function scoreBadgeColor(score: number): string {
  if (score >= 70) return "text-green-700 bg-green-50";
  if (score >= 40) return "text-amber-700 bg-amber-50";
  return "text-red-700 bg-red-50";
}

function severityBadge(action: CorrectiveAction) {
  if (action.severity === "HIGH") return "border-red-200 bg-red-50 text-red-700";
  if (action.severity === "MEDIUM") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-gray-200 bg-gray-50 text-gray-700";
}

function DimensionBar({ dim }: { dim: DimensionRow }) {
  const [showRationale, setShowRationale] = useState(false);
  return (
    <div className="group">
      <div className="flex items-center gap-2">
        <span className="w-32 shrink-0 text-xs text-gray-600">{DIMENSION_LABELS[dim.code]}</span>
        <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${scoreColor(dim.score)}`}
            style={{ width: `${dim.score}%` }}
          />
        </div>
        <span className={`w-8 shrink-0 text-right text-xs font-medium ${scoreBadgeColor(dim.score)}`}>
          {dim.score}
        </span>
        {dim.rationale && (
          <button
            onClick={() => setShowRationale((v) => !v)}
            className="shrink-0 text-gray-300 hover:text-gray-500 text-xs leading-none"
            aria-label="Toggle rationale"
          >
            <InfoIcon className="inline h-3 w-3" />
          </button>
        )}
      </div>
      {showRationale && dim.rationale && (
        <p className="ml-34 mt-0.5 text-xs text-gray-500 italic pl-[136px]">{dim.rationale}</p>
      )}
    </div>
  );
}

function CorrectiveActions({ actions }: { actions: CorrectiveAction[] }) {
  if (!actions || actions.length === 0) return null;
  return (
    <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50/60 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-800">Corrective actions</p>
      <div className="space-y-2">
        {actions.map((action, idx) => (
          <div key={`${action.dimension}-${idx}`} className="rounded-md border border-amber-100 bg-white p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${severityBadge(action)}`}>{action.severity}</span>
              <span className="text-xs font-semibold text-gray-900">{action.title}</span>
              <span className="text-[10px] text-gray-500">{DIMENSION_LABELS[action.dimension]}</span>
            </div>
            <p className="mt-1 text-xs text-gray-600">{action.action}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function EntityCard({ entity }: { entity: EntityBreakdown }) {
  const [open, setOpen] = useState(false);
  const hasDims = entity.dimensions.length > 0;
  const actions = entity.correctiveActions ?? [];
  return (
    <div className="border border-gray-100 rounded-lg px-4 py-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 text-left"
        disabled={!hasDims}
      >
        {/* Score donut (simplified as a colored circle) */}
        <div
          className={`h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-xs font-bold text-white ${
            entity.overallScore >= 70 ? "bg-green-500" : entity.overallScore >= 40 ? "bg-amber-400" : "bg-red-500"
          }`}
        >
          {entity.overallScore}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-gray-900 truncate">{entity.name}</span>
            {entity.isSelected && (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">Selected</span>
            )}
            {entity.weakDimensions.length > 0 && (
              <span className="rounded bg-red-50 border border-red-200 px-1.5 py-0.5 text-xs text-red-700">
                {entity.weakDimensions.length} weak {entity.weakDimensions.length === 1 ? "dimension" : "dimensions"}
              </span>
            )}
            {actions.length > 0 && (
              <span className="rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-xs text-amber-700">
                {actions.length} action{actions.length === 1 ? "" : "s"}
              </span>
            )}
            {!hasDims && (
              <span className="text-xs text-gray-400">No dimension scores — run AI Rematch</span>
            )}
          </div>
          {hasDims && !open && (
            <div className="mt-1 flex gap-0.5">
              {entity.dimensions.map((d) => (
                <div
                  key={d.code}
                  title={`${DIMENSION_LABELS[d.code]}: ${d.score}`}
                  className={`h-1 flex-1 rounded-sm ${scoreColor(d.score)}`}
                />
              ))}
            </div>
          )}
        </div>
        {hasDims && (
          <span className="shrink-0 text-gray-400 text-xs"><ChevronDownIcon className={open ? "inline h-3 w-3 rotate-180" : "inline h-3 w-3"} /></span>
        )}
      </button>

      {open && hasDims && (
        <div className="mt-3 space-y-1.5 border-t border-gray-50 pt-3">
          {entity.dimensions.map((dim) => (
            <DimensionBar key={dim.code} dim={dim} />
          ))}
          <p className="mt-1 text-xs text-gray-400">
            Source: {entity.dimensions[0]?.source ?? "—"} · Match score: {entity.matchScore}
          </p>
          <CorrectiveActions actions={actions} />
        </div>
      )}
    </div>
  );
}

export default function ScoreBreakdownPanel({ tenderId }: { tenderId: string }) {
  const [data, setData] = useState<BreakdownData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [entityType, setEntityType] = useState<"EXPERT" | "PROJECT">("EXPERT");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/score-breakdown`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Failed to load score breakdown");
      setData(json as BreakdownData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load score breakdown");
    } finally {
      setLoading(false);
    }
  }, [tenderId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          Loading match dimension scores…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">{error ?? "Unable to load score breakdown."}</p>
        <button onClick={load} className="mt-2 text-xs text-red-600 underline">Retry</button>
      </div>
    );
  }

  const hasAnyMatches = data.experts.length > 0 || data.projects.length > 0;

  if (!hasAnyMatches) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm text-gray-500">No expert or project matches yet. Run Engine or AI Rematch to generate dimension scores.</p>
      </div>
    );
  }

  const entities = entityType === "EXPERT" ? data.experts : data.projects;
  const weakCount = entities.filter((e) => e.weakDimensions.length > 0).length;
  const withDimensions = entities.filter((e) => e.dimensions.length > 0).length;
  const summaryActions = data.correctiveActionSummary ?? [];

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-800">Match Dimension Scores</span>
          {data.hasDimensionData && (
            <span className="text-xs text-gray-500">
              {withDimensions} of {entities.length} {entityType === "EXPERT" ? "experts" : "projects"} scored across 12 dimensions
            </span>
          )}
          {weakCount > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
              {weakCount} with weak dimensions
            </span>
          )}
          {summaryActions.length > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              {summaryActions.length} corrective action{summaryActions.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100" aria-label="Refresh scores"><RefreshIcon className="inline h-3 w-3" /></button>
          <button onClick={() => setExpanded((v) => !v)} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100">
            {expanded ? <span className="inline-flex items-center gap-0.5"><ChevronDownIcon className="inline h-3 w-3 rotate-180" /> Collapse</span> : <span className="inline-flex items-center gap-0.5"><ChevronDownIcon className="inline h-3 w-3" /> Show scores</span>}
          </button>
        </div>
      </div>

      {summaryActions.length > 0 && !expanded && (
        <div className="border-b border-amber-100 bg-amber-50 px-5 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-900">Top corrective actions</p>
          <div className="grid gap-2 md:grid-cols-2">
            {summaryActions.slice(0, 4).map((action, idx) => (
              <div key={`${action.entity ?? "entity"}-${action.dimension}-${idx}`} className="rounded-md border border-amber-200 bg-white p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${severityBadge(action)}`}>{action.severity}</span>
                  <span className="text-xs font-semibold text-gray-900">{action.entity ? `${action.entity}: ` : ""}{action.title}</span>
                </div>
                <p className="mt-1 text-xs text-gray-600">{action.action}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!data.hasDimensionData && (
        <div className="border-b border-amber-100 bg-amber-50 px-5 py-2 text-xs text-amber-800">
          <WarningIcon className="inline h-4 w-4 text-amber-500" /> No 12-perspective dimension scores found. Run AI Rematch to populate detailed dimension scoring.
        </div>
      )}

      {expanded && (
        <div className="divide-y divide-gray-100">
          {/* Entity type tabs */}
          <div className="flex gap-1 px-5 py-2">
            {(["EXPERT", "PROJECT"] as const).map((t) => {
              const count = t === "EXPERT" ? data.experts.length : data.projects.length;
              return (
                <button
                  key={t}
                  onClick={() => setEntityType(t)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${entityType === t ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                >
                  {t === "EXPERT" ? `Experts (${count})` : `Projects (${count})`}
                </button>
              );
            })}
          </div>

          {entities.length === 0 && (
            <div className="px-5 py-4 text-sm text-gray-500">
              No {entityType === "EXPERT" ? "expert" : "project"} matches for this tender.
            </div>
          )}

          <div className="px-4 py-3 space-y-2">
            {entities.map((entity) => (
              <EntityCard key={entity.entityId} entity={entity} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
