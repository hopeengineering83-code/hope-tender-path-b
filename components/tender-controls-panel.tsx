"use client";

import { useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { subscribeTenderWorkflowSync } from "@/lib/ui/tender-workflow-sync";
import { ChevronDownIcon, WarningIcon, DocumentIcon, ChatIcon, QuestionIcon, FlagIcon, CheckCircleIcon, CoinIcon } from "./icons";

type ControlType =
  | "ADDENDUM"
  | "CLARIFICATION"
  | "QUESTION"
  | "MILESTONE"
  | "TASK"
  | "RISK"
  | "COMMERCIAL_ASSUMPTION";

type Severity = "HIGH" | "MEDIUM" | "LOW";
type ControlStatus = "OPEN" | "RESOLVED";

type TenderControlRecord = {
  id: string;
  type: ControlType;
  title: string;
  description: string | null;
  dueDate: string | null;
  owner: string | null;
  severity: Severity | null;
  status: ControlStatus;
  createdAt: string;
  createdBy: string | null;
};

type ControlSummary = {
  total: number;
  open: number;
  resolved: number;
  highRisk: number;
  byType: Partial<Record<ControlType, number>>;
};

type SuggestionCode =
  | "METADATA_INCOMPLETE"
  | "REGEX_FALLBACK_UNAPPROVED"
  | "SOURCE_REFS_MISSING"
  | "MANDATORY_COVERAGE_ZERO"
  | "OUTSIDE_PLAN_DOCS"
  | "PLANNED_DOCS_NOT_GENERATED"
  | "NO_ACTIVE_EXPORT_CANDIDATES"
  | "AI_PROVIDERS_COOLING"
  | "AI_PROVIDERS_NOT_CONFIGURED"
  | "MISSING_OFFICIAL_ORIGINALS"
  | "QUALITY_FAILED_DOCS"
  | "SUBMISSION_PLAN_NOT_BUILT"
  | "WEAK_EXPERT_COVERAGE"
  | "WEAK_PROJECT_COVERAGE"
  | "JV_MITIGATION_NEEDED_EXPERTS"
  | "JV_MITIGATION_NEEDED_PROJECTS";

type SuggestedControl = {
  id: string;
  code: SuggestionCode;
  type: "TASK" | "RISK";
  title: string;
  description: string;
  severity: Severity;
  status: "SUGGESTED";
  nextAction: string;
  createdAt: string;
  createdBy: null;
};

type ControlsData = {
  controls: TenderControlRecord[];
  summary: ControlSummary;
  suggestedControls?: SuggestedControl[];
};

// HIGH-confidence codes — match isHighConfidenceSuggestion in
// lib/engine/tender-control-suggestions. Used by "Accept all high-confidence".
const HIGH_CONFIDENCE_CODES: SuggestionCode[] = [
  "AI_PROVIDERS_NOT_CONFIGURED",
  "REGEX_FALLBACK_UNAPPROVED",
  "METADATA_INCOMPLETE",
  "MANDATORY_COVERAGE_ZERO",
  "NO_ACTIVE_EXPORT_CANDIDATES",
  "MISSING_OFFICIAL_ORIGINALS",
  "QUALITY_FAILED_DOCS",
  "WEAK_EXPERT_COVERAGE",
  "WEAK_PROJECT_COVERAGE",
];

const TYPE_CONFIG: Record<ControlType, { label: string; color: string; icon: ReactNode }> = {
  ADDENDUM:             { label: "Addendum",          color: "bg-purple-100 text-purple-800 border-purple-300", icon: <DocumentIcon /> },
  CLARIFICATION:        { label: "Clarification",     color: "bg-blue-100 text-blue-800 border-blue-300",   icon: <ChatIcon /> },
  QUESTION:             { label: "Question",           color: "bg-sky-100 text-sky-800 border-sky-300",       icon: <QuestionIcon /> },
  MILESTONE:            { label: "Milestone",          color: "bg-green-100 text-green-800 border-green-300", icon: <FlagIcon /> },
  TASK:                 { label: "Task",               color: "bg-gray-100 text-gray-700 border-gray-300",    icon: <CheckCircleIcon /> },
  RISK:                 { label: "Risk",               color: "bg-red-100 text-red-800 border-red-300",       icon: <WarningIcon /> },
  COMMERCIAL_ASSUMPTION:{ label: "Commercial",         color: "bg-amber-100 text-amber-800 border-amber-300", icon: <CoinIcon /> },
};

const SEVERITY_CONFIG: Record<Severity, { label: string; color: string }> = {
  HIGH:   { label: "High",   color: "bg-red-100 text-red-700 border-red-300" },
  MEDIUM: { label: "Medium", color: "bg-amber-100 text-amber-800 border-amber-300" },
  LOW:    { label: "Low",    color: "bg-gray-100 text-gray-600 border-gray-300" },
};

const ALL_TYPES: ControlType[] = [
  "ADDENDUM", "CLARIFICATION", "QUESTION", "MILESTONE", "TASK", "RISK", "COMMERCIAL_ASSUMPTION",
];

const EMPTY_FORM = {
  type: "TASK" as ControlType,
  title: "",
  description: "",
  dueDate: "",
  owner: "",
  severity: "" as Severity | "",
  status: "OPEN" as ControlStatus,
};

export default function TenderControlsPanel({ tenderId }: { tenderId: string }) {
  const router = useRouter();
  const [data, setData] = useState<ControlsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [typeFilter, setTypeFilter] = useState<ControlType | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "OPEN" | "RESOLVED">("OPEN");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveErrors, setResolveErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/controls`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Failed to load controls");
      setData(json as ControlsData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load controls");
    } finally {
      setLoading(false);
    }
  }, [tenderId]);

  useEffect(() => { void load(); }, [load]);

  // Auto-refresh on workflow sync — no manual Refresh button needed.
  useEffect(() => subscribeTenderWorkflowSync(tenderId, () => { void load(); }), [load, tenderId]);

  // ── Suggested-control workflow (H). ───────────────────────────────────────
  const [suggestionBusy, setSuggestionBusy] = useState<string | null>(null);
  const [suggestionMsg, setSuggestionMsg] = useState<string | null>(null);

  async function acceptSuggestion(s: SuggestedControl) {
    setSuggestionBusy(s.id);
    setSuggestionMsg(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/controls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: s.type,
          title: s.title,
          description: s.description,
          severity: s.severity,
          status: "OPEN",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Accept failed (${res.status})`);
      setSuggestionMsg(`Accepted: ${s.title}`);
      await load();
      router.refresh();
    } catch (e) {
      setSuggestionMsg(e instanceof Error ? e.message : "Accept failed");
    } finally {
      setSuggestionBusy(null);
    }
  }

  async function rejectSuggestion(s: SuggestedControl) {
    const note = window.prompt(`Add a short audit note for dismissing "${s.title}":`);
    if (note === null) return; // cancelled
    setSuggestionBusy(s.id);
    setSuggestionMsg(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/controls/suggestions/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: s.code, note: note.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Reject failed (${res.status})`);
      setSuggestionMsg(`Dismissed: ${s.title}`);
      await load();
    } catch (e) {
      setSuggestionMsg(e instanceof Error ? e.message : "Reject failed");
    } finally {
      setSuggestionBusy(null);
    }
  }

  async function acceptAllHighConfidence() {
    const suggestions = data?.suggestedControls ?? [];
    const targets = suggestions.filter((s) => HIGH_CONFIDENCE_CODES.includes(s.code));
    if (targets.length === 0) { setSuggestionMsg("No high-confidence suggestions to accept."); return; }
    setSuggestionBusy("__bulk__");
    setSuggestionMsg(null);
    let accepted = 0;
    let failed = 0;
    for (const s of targets) {
      try {
        const res = await fetch(`/api/tenders/${tenderId}/controls`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: s.type, title: s.title, description: s.description, severity: s.severity, status: "OPEN" }),
        });
        if (res.ok) accepted++;
        else failed++;
      } catch { failed++; }
    }
    setSuggestionMsg(`Accept-all complete: ${accepted} accepted${failed > 0 ? `, ${failed} failed` : ""}.`);
    await load();
    router.refresh();
    setSuggestionBusy(null);
  }

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const submitControl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: Record<string, unknown> = {
        type: form.type,
        title: form.title.trim(),
        status: form.status,
      };
      if (form.description.trim()) body.description = form.description.trim();
      if (form.dueDate) body.dueDate = form.dueDate;
      if (form.owner.trim()) body.owner = form.owner.trim();
      if (form.severity) body.severity = form.severity;

      const res = await fetch(`/api/tenders/${tenderId}/controls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Failed to add control");
      setForm(EMPTY_FORM);
      setShowForm(false);
      void load();
      router.refresh();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Failed to add control");
    } finally {
      setSubmitting(false);
    }
  };

  const resolveControl = async (record: TenderControlRecord) => {
    setResolvingId(record.id);
    setResolveErrors((prev) => { const next = { ...prev }; delete next[record.id]; return next; });
    try {
      const res = await fetch(`/api/tenders/${tenderId}/controls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: record.type,
          title: record.title,
          description: record.description ?? undefined,
          owner: record.owner ?? undefined,
          severity: record.severity ?? undefined,
          status: "RESOLVED",
        }),
      });
      const json = await res.json().catch(() => ({})) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error ?? `Resolve failed (${res.status})`);
      void load();
      router.refresh();
    } catch (e) {
      setResolveErrors((prev) => ({ ...prev, [record.id]: e instanceof Error ? e.message : "Failed to resolve control" }));
    } finally {
      setResolvingId(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          Loading control ledger…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">{error ?? "Unable to load controls."}</p>
        <button onClick={load} className="mt-2 text-xs text-red-600 underline">Retry</button>
      </div>
    );
  }

  const { summary, controls } = data;
  const hasHighRisk = summary.highRisk > 0;

  const filteredControls = controls.filter((c) => {
    if (typeFilter !== "ALL" && c.type !== typeFilter) return false;
    if (statusFilter !== "ALL" && c.status !== statusFilter) return false;
    return true;
  });

  return (
    <div id="tender-settings" className="rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-800">Tender Controls Ledger</span>
          <div className="flex items-center gap-2">
            {summary.open > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                {summary.open} open
              </span>
            )}
            {hasHighRisk && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                {summary.highRisk} high-risk
              </span>
            )}
            {summary.open === 0 && summary.total > 0 && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                All resolved
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setShowForm((v) => !v); setSubmitError(null); }}
            aria-expanded={showForm}
            aria-controls="controls-add-form"
            className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
          >
            + Add control
          </button>
          <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} aria-controls="controls-ledger-list" className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100">
            {expanded ? <><ChevronDownIcon className="rotate-180" /> Collapse</> : <><ChevronDownIcon /> Show ledger</>}
          </button>
        </div>
      </div>

      {/* Summary grid */}
      <div className="grid grid-cols-4 gap-px border-b border-gray-100 bg-gray-100 text-center text-xs">
        {[
          { label: "Total",    value: summary.total,    color: "text-gray-800" },
          { label: "Open",     value: summary.open,     color: summary.open > 0 ? "text-amber-800" : "text-gray-400" },
          { label: "Resolved", value: summary.resolved, color: "text-green-700" },
          { label: "High Risk",value: summary.highRisk, color: summary.highRisk > 0 ? "text-red-600" : "text-gray-400" },
        ].map((cell) => (
          <div key={cell.label} className="bg-white py-2">
            <div className={`text-base font-bold ${cell.color}`}>{cell.value}</div>
            <div className="text-gray-500">{cell.label}</div>
          </div>
        ))}
      </div>

      {/* Suggested controls (derived from lifecycle blockers) — H */}
      {data && data.suggestedControls && data.suggestedControls.length > 0 && (
        <div className="border-b border-amber-100 bg-amber-50 px-5 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">Suggested controls ({data.suggestedControls.length})</p>
              <p className="mt-0.5 text-[11px] text-amber-800">Derived from the current lifecycle state. Accept to add a real ledger row; dismiss to hide on subsequent loads (audit-logged).</p>
            </div>
            <button
              type="button"
              onClick={acceptAllHighConfidence}
              disabled={suggestionBusy !== null}
              className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
              title="Accept every HIGH-severity suggestion (regex fallback, tender details, mandatory coverage, etc.) as real ledger rows."
            >
              {suggestionBusy === "__bulk__" ? "Accepting…" : "Accept all high-confidence"}
            </button>
          </div>
          <ul className="mt-2 space-y-2">
            {data.suggestedControls.map((s) => (
              <li key={s.id} className="rounded-lg border border-amber-200 bg-white p-2 text-xs">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${SEVERITY_CONFIG[s.severity].color}`}>{SEVERITY_CONFIG[s.severity].label}</span>
                      <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">{TYPE_CONFIG[s.type].icon} {TYPE_CONFIG[s.type].label}</span>
                      <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-mono text-slate-500">{s.code}</span>
                    </div>
                    <p className="mt-1 font-semibold text-slate-900">{s.title}</p>
                    <p className="mt-0.5 leading-relaxed text-slate-700">{s.description}</p>
                    <p className="mt-1 text-[11px] text-emerald-700">Next: {s.nextAction}</p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => void acceptSuggestion(s)}
                      disabled={suggestionBusy !== null}
                      className="rounded bg-emerald-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {suggestionBusy === s.id ? "Working…" : "Accept"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void rejectSuggestion(s)}
                      disabled={suggestionBusy !== null}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {suggestionMsg && (
            <p className="mt-2 text-[11px] text-amber-900">{suggestionMsg}</p>
          )}
        </div>
      )}

      {/* Add control form */}
      {showForm && (
        <form id="controls-add-form" onSubmit={submitControl} className="border-b border-gray-100 bg-gray-50 px-5 py-4 space-y-3">
          <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">New control entry</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-600">Type <span className="text-red-500">*</span></label>
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ControlType }))}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                required
              >
                {ALL_TYPES.map((t) => (
                  <option key={t} value={t}>{TYPE_CONFIG[t].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-600">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ControlStatus }))}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="OPEN">Open</option>
                <option value="RESOLVED">Resolved</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-600">Title <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Brief summary of the control event"
              maxLength={240}
              required
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-600">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Optional detail, context, or resolution notes"
              rows={2}
              maxLength={1200}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-600">Owner</label>
              <input
                type="text"
                value={form.owner}
                onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}
                placeholder="Name or email"
                maxLength={120}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-600">Due date</label>
              <input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-600">Severity</label>
              <select
                value={form.severity}
                onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value as Severity | "" }))}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">None</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
            </div>
          </div>
          {submitError && <p className="text-xs text-red-600">{submitError}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting || !form.title.trim()}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {submitting ? "Adding…" : "Add entry"}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setForm(EMPTY_FORM); setSubmitError(null); }}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Empty state */}
      {summary.total === 0 && !expanded && (
        <div className="px-5 py-4 text-sm text-gray-500">
          No controls logged yet. Use &ldquo;Add control&rdquo; to record addenda, risks, tasks, or milestones.
        </div>
      )}

      {/* Ledger list */}
      {expanded && (
        <div id="controls-ledger-list" className="divide-y divide-gray-100">
          {/* Filters */}
          <div className="flex flex-wrap gap-2 px-5 py-2">
            {/* Status filter */}
            <div className="flex gap-1">
              {(["ALL", "OPEN", "RESOLVED"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${statusFilter === s ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                >
                  {s === "ALL" ? `All (${summary.total})` : s === "OPEN" ? `Open (${summary.open})` : `Resolved (${summary.resolved})`}
                </button>
              ))}
            </div>
            {/* Type filter */}
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => setTypeFilter("ALL")}
                className={`rounded px-2 py-1 text-xs font-medium transition-colors ${typeFilter === "ALL" ? "bg-gray-700 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >
                All types
              </button>
              {ALL_TYPES.filter((t) => (summary.byType[t] ?? 0) > 0).map((t) => {
                const cfg = TYPE_CONFIG[t];
                return (
                  <button
                    key={t}
                    onClick={() => setTypeFilter(typeFilter === t ? "ALL" : t)}
                    className={`rounded px-2 py-1 text-xs font-medium transition-colors ${typeFilter === t ? "bg-gray-700 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                  >
                    <span aria-hidden="true">{cfg.icon}</span> {cfg.label} ({summary.byType[t]})
                  </button>
                );
              })}
            </div>
          </div>

          {filteredControls.length === 0 && (
            <div className="px-5 py-4 text-sm text-gray-500">No controls match this filter.</div>
          )}

          {filteredControls.map((record) => {
            const typeCfg = TYPE_CONFIG[record.type];
            const isOpen = expandedRows.has(record.id);
            const resolving = resolvingId === record.id;
            const isResolved = record.status === "RESOLVED";
            return (
              <div key={record.id} className={`px-5 py-3 ${isResolved ? "opacity-60" : ""}`}>
                <button
                  type="button"
                  onClick={() => toggleRow(record.id)}
                  aria-expanded={isOpen}
                  aria-controls={`control-row-${record.id}`}
                  className="flex w-full items-start gap-3 text-left"
                >
                  <span aria-hidden="true" className="mt-0.5 shrink-0 text-base leading-none">{typeCfg.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{record.title}</span>
                      <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${typeCfg.color}`}>
                        {typeCfg.label}
                      </span>
                      {record.severity && (
                        <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${SEVERITY_CONFIG[record.severity].color}`}>
                          {SEVERITY_CONFIG[record.severity].label}
                        </span>
                      )}
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${isResolved ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-800"}`}>
                        {isResolved ? "Resolved" : "Open"}
                      </span>
                    </div>
                    {!isOpen && (
                      <p className="mt-0.5 text-xs text-gray-400">
                        {new Date(record.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        {record.owner && ` · ${record.owner}`}
                        {record.dueDate && ` · Due ${record.dueDate}`}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-gray-400"><ChevronDownIcon className={isOpen ? "rotate-180" : ""} /></span>
                </button>

                {isOpen && (
                  <div id={`control-row-${record.id}`} className="ml-7 mt-2 space-y-2">
                    <div className="grid grid-cols-3 gap-2 text-xs text-gray-600">
                      <div><span className="text-gray-400">Logged:</span> {new Date(record.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</div>
                      {record.owner && <div><span className="text-gray-400">Owner:</span> {record.owner}</div>}
                      {record.dueDate && <div><span className="text-gray-400">Due:</span> {record.dueDate}</div>}
                    </div>
                    {record.description && (
                      <p className="text-xs text-gray-700 rounded bg-gray-50 px-3 py-2 border border-gray-100">{record.description}</p>
                    )}
                    {!isResolved && (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void resolveControl(record)}
                          disabled={resolving}
                          className="rounded border border-green-300 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-800 hover:bg-green-100 disabled:opacity-60"
                        >
                          {resolving ? "Resolving…" : "Mark resolved"}
                        </button>
                        {resolveErrors[record.id] && (
                          <span className="text-xs text-red-600">{resolveErrors[record.id]}</span>
                        )}
                      </div>
                    )}
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
