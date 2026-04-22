"use client";
import { useState, useEffect } from "react";

type Log = {
  id: string; action: string; entityType: string | null; entityId: string | null;
  description: string; metadata: string; createdAt: string;
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

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
    " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

export default function ActivityPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const limit = 30;

  async function load(p = 1, action = "") {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(limit) });
      if (action) params.set("action", action);
      const res = await fetch(`/api/audit?${params}`);
      const data = await res.json();
      setLogs(data.logs ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(1, filter); }, []);

  function handleFilter(action: string) {
    setFilter(action);
    setPage(1);
    load(1, action);
  }

  function handlePage(p: number) {
    setPage(p);
    load(p, filter);
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

      <div className="flex flex-wrap gap-2 text-xs">
        {["", "TENDER_FILE_UPLOAD", "ENGINE_RUN", "TENDER_GENERATED", "TENDER_VALIDATED", "EXPORT_PACKAGE_DOWNLOAD", "AI_ANALYZE"].map((a) => (
          <button
            key={a || "ALL"}
            onClick={() => handleFilter(a)}
            className={`rounded-full px-3 py-1 border ${filter === a ? "bg-black text-white border-black" : "bg-white text-slate-600 border-slate-200 hover:border-black"}`}
          >
            {a || "All Actions"}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
        {loading ? (
          <p className="text-center text-slate-400 py-12">Loading…</p>
        ) : logs.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <p>No activity recorded yet.</p>
            <p className="text-xs mt-1">Actions like uploads, engine runs, and exports appear here automatically.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500 text-xs">
              <tr>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Entity</th>
                <th className="px-4 py-3 font-medium">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_COLORS[log.action] ?? "bg-slate-100 text-slate-600"}`}>
                      {log.action.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700 max-w-xs truncate">{log.description}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs hidden md:table-cell">
                    {log.entityType ? `${log.entityType}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{fmtDate(log.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <p>{total} total entries</p>
          <div className="flex gap-1">
            <button onClick={() => handlePage(page - 1)} disabled={page === 1} className="rounded px-3 py-1 border disabled:opacity-40 hover:border-black">‹</button>
            <span className="px-3 py-1">{page} / {totalPages}</span>
            <button onClick={() => handlePage(page + 1)} disabled={page >= totalPages} className="rounded px-3 py-1 border disabled:opacity-40 hover:border-black">›</button>
          </div>
        </div>
      )}
    </div>
  );
}
