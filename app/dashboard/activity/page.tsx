"use client";
import { useState, useEffect } from "react";

type Log = {
  id: string; action: string; entityType: string | null;
  description: string; createdAt: string;
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
};

const FILTERS = ["", "TENDER_FILE_UPLOAD", "ENGINE_RUN", "TENDER_GENERATED", "TENDER_VALIDATED", "EXPORT_PACKAGE_DOWNLOAD", "AI_ANALYZE"];

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
    " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function formatAction(action: string): string {
  return action.replace(/_/g, " ");
}

function actionBadgeClass(action: string): string {
  return ACTION_COLORS[action] ?? "bg-slate-100 text-slate-600";
}

function ActivityCard({ log }: { log: Log }) {
  return (
    <article className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby={`activity-${log.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span id={`activity-${log.id}`} className={`max-w-full break-words rounded-full px-2 py-0.5 text-xs font-medium ${actionBadgeClass(log.action)}`}>
          {formatAction(log.action)}
        </span>
        <time className="text-xs text-slate-500" dateTime={log.createdAt}>{fmtDate(log.createdAt)}</time>
      </div>
      <p className="break-words text-sm text-slate-700">{log.description}</p>
      <p className="text-xs text-slate-500">Entity: {log.entityType ?? "Not shown"}</p>
    </article>
  );
}

export default function ActivityPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const limit = 30;

  async function load(p = 1, action = "") {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(limit) });
      if (action) params.set("action", action);
      const res = await fetch(`/api/audit?${params}`);
      if (!res.ok) {
        throw new Error("ACTIVITY_FETCH_FAILED");
      }
      const data = await res.json();
      setLogs(Array.isArray(data.logs) ? data.logs : []);
      setTotal(Number.isFinite(data.total) ? data.total : 0);
    } catch {
      setLogs([]);
      setTotal(0);
      setError("Activity logs could not be loaded. Try refreshing the page.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(1, ""); }, []);

  function handleFilter(action: string) {
    setFilter(action);
    setPage(1);
    load(1, action);
  }

  function handlePage(p: number) {
    const nextPage = Math.max(1, p);
    setPage(nextPage);
    load(nextPage, filter);
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Activity Logs</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Safe presentation of uploads, analysis runs, generation, export, and overrides.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-xs" aria-label="Activity filters">
        {FILTERS.map((a) => (
          <button
            key={a || "ALL"}
            type="button"
            onClick={() => handleFilter(a)}
            aria-pressed={filter === a}
            className={`rounded-full border px-3 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-black ${filter === a ? "border-black bg-black text-white" : "border-slate-200 bg-white text-slate-600 hover:border-black"}`}
          >
            {a ? formatAction(a) : "All Actions"}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border bg-white shadow-sm">
        {loading ? (
          <p role="status" className="py-12 text-center text-slate-400">Loading activity logs...</p>
        ) : error ? (
          <div role="alert" className="space-y-3 p-6 text-center">
            <p className="text-sm font-medium text-red-700">{error}</p>
            <button
              type="button"
              onClick={() => load(page, filter)}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:border-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              Retry activity logs
            </button>
          </div>
        ) : logs.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <p>No activity recorded yet.</p>
            <p className="mt-1 text-xs">Actions like uploads, engine runs, and exports appear here automatically.</p>
          </div>
        ) : (
          <>
            <div className="space-y-3 p-3 md:hidden">
              {logs.map((log) => <ActivityCard key={log.id} log={log} />)}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full table-fixed text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="w-36 px-4 py-3 font-medium lg:w-60">Action</th>
                    <th className="px-4 py-3 font-medium">Description</th>
                    <th className="w-28 px-4 py-3 font-medium">Entity</th>
                    <th className="w-32 px-4 py-3 font-medium lg:w-40">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <span className={`inline-block max-w-full truncate rounded-full px-2 py-0.5 align-bottom text-xs font-medium ${actionBadgeClass(log.action)}`}>
                          {formatAction(log.action)}
                        </span>
                      </td>
                      <td className="truncate px-4 py-3 text-slate-700">{log.description}</td>
                      <td className="truncate px-4 py-3 text-xs text-slate-400">
                        {log.entityType ?? "Not shown"}
                      </td>
                      <td className="truncate px-4 py-3 text-xs text-slate-400">{fmtDate(log.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {totalPages > 1 && (
        <nav className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500" aria-label="Activity pagination">
          <p>{total} total entries</p>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => handlePage(page - 1)}
              disabled={page === 1 || loading}
              aria-label="Previous activity page"
              className="rounded border px-3 py-1 hover:border-black disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
            >
              Previous
            </button>
            <span className="px-3 py-1" aria-current="page">{page} / {totalPages}</span>
            <button
              type="button"
              onClick={() => handlePage(page + 1)}
              disabled={page >= totalPages || loading}
              aria-label="Next activity page"
              className="rounded border px-3 py-1 hover:border-black disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
            >
              Next
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
