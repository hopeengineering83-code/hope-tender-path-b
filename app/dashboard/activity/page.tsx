"use client";

import { useCallback, useEffect, useState } from "react";

type Log = {
  id: string;
  action: string;
  entityType: string | null;
  description: string;
  createdAt: string;
  count: number;
};

const ACTION_COLORS: Record<string, string> = {
  LOGIN: "bg-slate-100 text-slate-600",
  LOGOUT: "bg-slate-100 text-slate-500",
  TENDER_FILE_UPLOAD: "bg-blue-100 text-blue-700",
  COMPANY_DOCUMENT_UPLOAD: "bg-indigo-100 text-indigo-700",
  COMPANY_ASSET_UPLOAD: "bg-purple-100 text-purple-700",
  TENDER_CREATE: "bg-green-100 text-green-700",
  TENDER_ANALYZED: "bg-sky-100 text-sky-700",
  TENDER_MATCHED: "bg-violet-100 text-violet-700",
  TENDER_GENERATED: "bg-amber-100 text-amber-700",
  TENDER_VALIDATED: "bg-teal-100 text-teal-700",
  TENDER_EXPORTED: "bg-emerald-100 text-emerald-700",
  ENGINE_RUN: "bg-orange-100 text-orange-700",
  EXPORT_PACKAGE_DOWNLOAD: "bg-pink-100 text-pink-700",
  AI_ANALYZE: "bg-fuchsia-100 text-fuchsia-700",
  AI_PROPOSAL: "bg-fuchsia-100 text-fuchsia-700",
  EXPERT_REVIEW: "bg-emerald-100 text-emerald-700",
  PROJECT_REVIEW: "bg-emerald-100 text-emerald-700",
};

const FILTERS = [
  "",
  "TENDER_FILE_UPLOAD",
  "ENGINE_RUN",
  "TENDER_GENERATED",
  "TENDER_VALIDATED",
  "EXPORT_PACKAGE_DOWNLOAD",
  "AI_ANALYZE",
] as const;

function fmtDate(iso: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "Unknown time";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
    " " + date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function actionLabel(action: string) {
  return action
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function ActionBadge({ log }: { log: Log }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span
        className={`inline-block max-w-full truncate rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_COLORS[log.action] ?? "bg-slate-100 text-slate-600"}`}
        title={actionLabel(log.action)}
      >
        {actionLabel(log.action)}
      </span>
      {log.count > 1 && <span className="shrink-0 rounded-full bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">×{log.count}</span>}
    </div>
  );
}

export default function ActivityPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [total, setTotal] = useState(0);
  const [groupedOnPage, setGroupedOnPage] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const limit = 30;

  const load = useCallback(async (requestedPage: number, action: string) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(requestedPage), limit: String(limit) });
      if (action) params.set("action", action);
      const response = await fetch(`/api/audit?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Activity logs could not be loaded");
      const data = await response.json() as {
        logs?: Log[];
        total?: number;
        groupedOnPage?: number;
      };
      setLogs(Array.isArray(data.logs) ? data.logs : []);
      setTotal(typeof data.total === "number" ? data.total : 0);
      setGroupedOnPage(typeof data.groupedOnPage === "number" ? data.groupedOnPage : 0);
    } catch (loadError) {
      setLogs([]);
      setTotal(0);
      setGroupedOnPage(0);
      setError(loadError instanceof Error ? loadError.message : "Activity logs could not be loaded");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(1, "");
  }, [load]);

  function handleFilter(action: string) {
    setFilter(action);
    setPage(1);
    void load(1, action);
  }

  function handlePage(nextPage: number) {
    setPage(nextPage);
    void load(nextPage, filter);
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="min-w-0 space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Activity Logs</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-slate-500">
          Privacy-minimized audit events for your workspace. Internal identifiers, file paths, and personal contact details are hidden.
        </p>
      </header>

      <div className="flex flex-wrap gap-2 text-xs" aria-label="Activity filters">
        {FILTERS.map((action) => (
          <button
            key={action || "ALL"}
            type="button"
            onClick={() => handleFilter(action)}
            aria-pressed={filter === action}
            className={`min-h-10 rounded-full border px-3 py-1 ${filter === action ? "border-black bg-black text-white" : "border-slate-200 bg-white text-slate-600 hover:border-black"}`}
          >
            {action ? actionLabel(action) : "All Actions"}
          </button>
        ))}
      </div>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <section className="min-w-0 overflow-hidden rounded-2xl border bg-white shadow-sm" aria-label="Activity events">
        {loading ? (
          <p role="status" className="py-12 text-center text-slate-400">Loading…</p>
        ) : logs.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <p>No activity recorded yet.</p>
            <p className="mt-1 text-xs">Workspace actions appear here after privacy minimization.</p>
          </div>
        ) : (
          <>
            <div className="divide-y md:hidden">
              {logs.map((log) => (
                <article key={log.id} className="min-w-0 space-y-3 p-4">
                  <ActionBadge log={log} />
                  <p className="break-words text-sm text-slate-700">{log.description}</p>
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                    <span className="min-w-0 break-words">{log.entityType ?? "Workspace"}</span>
                    <time className="shrink-0" dateTime={log.createdAt}>{fmtDate(log.createdAt)}</time>
                  </div>
                </article>
              ))}
            </div>

            <div className="hidden min-w-0 md:block">
              <table className="w-full table-fixed text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="w-1/4 px-4 py-3 font-medium">Action</th>
                    <th className="w-2/5 px-4 py-3 font-medium">Description</th>
                    <th className="w-1/6 px-4 py-3 font-medium">Entity</th>
                    <th className="px-4 py-3 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="min-w-0 px-4 py-3"><ActionBadge log={log} /></td>
                      <td className="truncate px-4 py-3 text-slate-700" title={log.description}>{log.description}</td>
                      <td className="truncate px-4 py-3 text-xs text-slate-400" title={log.entityType ?? "Workspace"}>{log.entityType ?? "Workspace"}</td>
                      <td className="truncate px-4 py-3 text-xs text-slate-400"><time dateTime={log.createdAt}>{fmtDate(log.createdAt)}</time></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
        <p>{total} tenant-scoped audit records{groupedOnPage > 0 ? ` · ${groupedOnPage} duplicate event(s) grouped on this page` : ""}</p>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => handlePage(page - 1)} disabled={page === 1} className="min-h-10 rounded border px-3 py-1 disabled:opacity-50" aria-label="Previous activity page">Previous</button>
          <span className="px-3 py-1">{page} / {totalPages}</span>
          <button type="button" onClick={() => handlePage(page + 1)} disabled={page >= totalPages} className="min-h-10 rounded border px-3 py-1 disabled:opacity-50" aria-label="Next activity page">Next</button>
        </div>
      </div>
    </div>
  );
}
