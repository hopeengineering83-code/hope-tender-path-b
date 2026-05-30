"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

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

type ControlsData = {
  controls: TenderControlRecord[];
  summary: ControlSummary;
};

const TYPE_CONFIG: Record<ControlType, { label: string; color: string; icon: string }> = {
  ADDENDUM:             { label: "Addendum",          color: "bg-purple-100 text-purple-800 border-purple-300", icon: "📄" },
  CLARIFICATION:        { label: "Clarification",     color: "bg-blue-100 text-blue-800 border-blue-300",   icon: "💬" },
  QUESTION:             { label: "Question",           color: "bg-sky-100 text-sky-800 border-sky-300",       icon: "❓" },
  MILESTONE:            { label: "Milestone",          color: "bg-green-100 text-green-800 border-green-300", icon: "🏁" },
  TASK:                 { label: "Task",               color: "bg-gray-100 text-gray-700 border-gray-300",    icon: "✅" },
  RISK:                 { label: "Risk",               color: "bg-red-100 text-red-800 border-red-300",       icon: "⚠️" },
  COMMERCIAL_ASSUMPTION:{ label: "Commercial",         color: "bg-amber-100 text-amber-800 border-amber-300", icon: "💰" },
};

const SEVERITY_CONFIG: Record<Severity, { label: string; color: string }> = {
  HIGH:   { label: "High",   color: "bg-red-100 text-red-700 border-red-300" },
  MEDIUM: { label: "Medium", color: "bg-amber-100 text-amber-700 border-amber-300" },
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
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Failed to resolve control");
      void load();
      router.refresh();
    } catch {
      // silently ignore — user can retry
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
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
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
          <button onClick={load} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100" aria-label="Refresh controls">↻</button>
          <button
            onClick={() => { setShowForm((v) => !v); setSubmitError(null); }}
            className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
          >
            + Add control
          </button>
          <button onClick={() => setExpanded((v) => !v)} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100">
            {expanded ? "▲ Collapse" : "▼ Show ledger"}
          </button>
        </div>
      </div>

      {/* Summary grid */}
      <div className="grid grid-cols-4 gap-px border-b border-gray-100 bg-gray-100 text-center text-xs">
        {[
          { label: "Total",    value: summary.total,    color: "text-gray-800" },
          { label: "Open",     value: summary.open,     color: summary.open > 0 ? "text-amber-700" : "text-gray-400" },
          { label: "Resolved", value: summary.resolved, color: "text-green-700" },
          { label: "High Risk",value: summary.highRisk, color: summary.highRisk > 0 ? "text-red-600" : "text-gray-400" },
        ].map((cell) => (
          <div key={cell.label} className="bg-white py-2">
            <div className={`text-base font-bold ${cell.color}`}>{cell.value}</div>
            <div className="text-gray-500">{cell.label}</div>
          </div>
        ))}
      </div>

      {/* Add control form */}
      {showForm && (
        <form onSubmit={submitControl} className="border-b border-gray-100 bg-gray-50 px-5 py-4 space-y-3">
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
                  <option key={t} value={t}>{TYPE_CONFIG[t].icon} {TYPE_CONFIG[t].label}</option>
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
              className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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
        <div className="divide-y divide-gray-100">
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
                    {cfg.icon} {cfg.label} ({summary.byType[t]})
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
                  onClick={() => toggleRow(record.id)}
                  className="flex w-full items-start gap-3 text-left"
                >
                  <span className="mt-0.5 shrink-0 text-base leading-none">{typeCfg.icon}</span>
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
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${isResolved ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
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
                  <span className="shrink-0 text-gray-400">{isOpen ? "▲" : "▼"}</span>
                </button>

                {isOpen && (
                  <div className="ml-7 mt-2 space-y-2">
                    <div className="grid grid-cols-3 gap-2 text-xs text-gray-600">
                      <div><span className="text-gray-400">Logged:</span> {new Date(record.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</div>
                      {record.owner && <div><span className="text-gray-400">Owner:</span> {record.owner}</div>}
                      {record.dueDate && <div><span className="text-gray-400">Due:</span> {record.dueDate}</div>}
                    </div>
                    {record.description && (
                      <p className="text-xs text-gray-700 rounded bg-gray-50 px-3 py-2 border border-gray-100">{record.description}</p>
                    )}
                    {!isResolved && (
                      <button
                        onClick={() => void resolveControl(record)}
                        disabled={resolving}
                        className="rounded border border-green-300 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-800 hover:bg-green-100 disabled:opacity-50"
                      >
                        {resolving ? "Resolving…" : "Mark resolved"}
                      </button>
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
