"use client";

import { useEffect, useState } from "react";

type Log = {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  description: string;
  metadata: string;
  createdAt: string;
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

const ACTION_FILTERS = [
  "",
  "TENDER_FILE_UPLOAD",
  "ENGINE_RUN",
  "TENDER_GENERATED",
  "TENDER_VALIDATED",
  "EXPORT_PACKAGE_DOWNLOAD",
  "AI_ANALYZE",
] as const;

const ACTION_LABELS: Record<string, string> = {
  LOGIN: "Signed in",
  LOGOUT: "Signed out",
  TENDER_FILE_UPLOAD: "Tender file uploaded",
  COMPANY_DOCUMENT_UPLOAD: "Company document uploaded",
  COMPANY_ASSET_UPLOAD: "Company asset uploaded",
  TENDER_CREATE: "Tender created",
  TENDER_ANALYZED: "Tender analyzed",
  TENDER_MATCHED: "Tender matched",
  TENDER_GENERATED: "Documents generated",
  TENDER_VALIDATED: "Tender validated",
  TENDER_EXPORTED: "Tender exported",
  ENGINE_RUN: "Engine run",
  EXPORT_PACKAGE_DOWNLOAD: "Export package downloaded",
  AI_ANALYZE: "AI analysis",
  AI_PROPOSAL: "AI proposal",
};

function formatAction(action: string) {
  return ACTION_LABELS[action] ?? action
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function fmtDate(iso: string) {
  const date = new Date(iso);
  return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} ${date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
}

export default function ActivityPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const limit = 30;

  async function load(nextPage = 1, action = "") {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(nextPage), limit: String(limit) });
      if (action) params.set("action", action);
      const response = await fetch(`/api/audit?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Audit request failed with status ${response.status}`);
      const data = await response.json();
      setLogs(Array.isArray(data.logs) ? data.logs : []);
      setTotal(typeof data.total === "number" ? data.total : 0);
    } catch {
      setLogs([]);
      setTotal(0);
      setError("Activity logs could not be loaded. Retry before relying on the audit trail.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(1, "");
  }, []);

  function handleFilter(action: string) {
    setFilter(action);
    setPage(1);
    void load(1, action);
  }

  function handlePage(nextPage: number) {
    setPage(nextPage);
    void load(nextPage, filter);
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Activity Logs</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Complete audit trail of uploads, analysis runs, generation, export, and overrides.
        </p>
      </div>

      <label className="block text-sm font-medium text-slate-700 md:hidden">
        <span className="mb-1 block text-xs text-slate-500">Filter by activity</span>
        <select
          value={filter}
          onChange={(event) => handleFilter(event.target.value)}
          className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
        >
          {ACTION_FILTERS.map((action) => (
            <option key={action || "ALL"} value={action}>{action ? formatAction(action) : "All activity"}</option>
          ))}
        </select>
      </label>

      <div className="hidden flex-wrap gap-2 text-xs md:flex" role="group" aria-label="Activity filters">
        {ACTION_FILTERS.map((action) => (
          <button
            key={action || "ALL"}
            type="button"
            onClick={() => handleFilter(action)}
            aria-pressed={filter === action}
            className={`rounded-full border px-3 py-1 ${filter === action ? "border-black bg-black text-white" : "border-slate-200 bg-white text-slate-600 hover:border-black"}`}
          >
            {action ? formatAction(action) : "All activity"}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" onClick={() => void load(page, filter)} className="rounded-lg border border-red-300 bg-white px-3 py-1.5 font-medium">Retry</button>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        {loading ? (
          <p role="status" className="py-12 text-center text-slate-400">Loading activity…</p>
        ) : logs.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <p>{error ? "No current activity data is available." : "No activity recorded yet."}</p>
            {!error && <p className="mt-1 text-xs">Actions like uploads, engine runs, and exports appear here automatically.</p>}
          </div>
        ) : (
          <>
            <div className="divide-y md:hidden">
              {logs.map((log) => (
                <article key={log.id} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className={`inline-flex max-w-full rounded-full px-2 py-1 text-xs font-medium ${ACTION_COLORS[log.action] ?? "bg-slate-100 text-slate-600"}`}>
                      {formatAction(log.action)}
                    </span>
                    <time dateTime={log.createdAt} className="text-xs text-slate-400">{fmtDate(log.createdAt)}</time>
                  </div>
                  <p className="break-words text-sm text-slate-700">{log.description}</p>
                  {log.entityType && <p className="text-xs text-slate-500">Entity: {formatAction(log.entityType)}</p>}
                </article>
              ))}
            </div>

            <table className="hidden w-full table-fixed text-sm md:table">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="w-48 px-4 py-3 font-medium lg:w-60">Action</th>
                  <th className="px-4 py-3 font-medium">Description</th>
                  <th className="w-28 px-4 py-3 font-medium">Entity</th>
                  <th className="w-40 px-4 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className={`inline-block max-w-full truncate rounded-full px-2 py-0.5 text-xs font-medium align-bottom ${ACTION_COLORS[log.action] ?? "bg-slate-100 text-slate-600"}`} title={formatAction(log.action)}>
                        {formatAction(log.action)}
                      </span>
                    </td>
                    <td className="truncate px-4 py-3 text-slate-700" title={log.description}>{log.description}</td>
                    <td className="truncate px-4 py-3 text-xs text-slate-400" title={log.entityType ?? undefined}>{log.entityType ? formatAction(log.entityType) : "—"}</td>
                    <td className="truncate px-4 py-3 text-xs text-slate-400"><time dateTime={log.createdAt}>{fmtDate(log.createdAt)}</time></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {totalPages > 1 && (
        <nav aria-label="Activity log pages" className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
          <p>{total} total entries</p>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => handlePage(page - 1)} disabled={page === 1} className="rounded border px-3 py-1 disabled:opacity-60 hover:border-black">Previous</button>
            <span className="px-3 py-1">Page {page} of {totalPages}</span>
            <button type="button" onClick={() => handlePage(page + 1)} disabled={page >= totalPages} className="rounded border px-3 py-1 disabled:opacity-60 hover:border-black">Next</button>
          </div>
        </nav>
      )}
    </div>
  );
}
