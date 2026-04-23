"use client";

import { useState } from "react";
import Link from "next/link";

type Gap = {
  id: string;
  title: string;
  description: string;
  severity: string;
  isResolved: boolean;
  mitigationPlan?: string | null;
  resolvedNote?: string | null;
};

type Tender = {
  id: string;
  title: string;
  status: string;
  requirements: { id: string }[];
  complianceGaps: Gap[];
};

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-700 border-red-200",
  HIGH: "bg-orange-100 text-orange-700 border-orange-200",
  MEDIUM: "bg-amber-100 text-amber-700 border-amber-200",
  LOW: "bg-slate-100 text-slate-600 border-slate-200",
};

export function ComplianceDashboard({ tenders: initial }: { tenders: Tender[] }) {
  const [tenders, setTenders] = useState(initial);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [noteMap, setNoteMap] = useState<Record<string, string>>({});
  const [filterTender, setFilterTender] = useState("all");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterStatus, setFilterStatus] = useState("unresolved");

  async function toggleGap(tenderId: string, gapId: string, isResolved: boolean, note: string) {
    setResolvingId(gapId);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/gaps/${gapId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isResolved, resolvedNote: note }),
      });
      if (res.ok) {
        const updated = await res.json() as Gap;
        setTenders((prev) =>
          prev.map((t) =>
            t.id !== tenderId ? t : {
              ...t,
              complianceGaps: t.complianceGaps.map((g) =>
                g.id !== gapId ? g : { ...g, isResolved: updated.isResolved, resolvedNote: updated.resolvedNote }
              ),
            }
          )
        );
        setNoteMap((m) => { const n = { ...m }; delete n[gapId]; return n; });
      }
    } finally {
      setResolvingId(null);
    }
  }

  const allGaps = tenders.flatMap((t) =>
    t.complianceGaps.map((g) => ({ ...g, tenderId: t.id, tenderTitle: t.title }))
  );

  const filtered = allGaps.filter((g) => {
    if (filterTender !== "all" && g.tenderId !== filterTender) return false;
    if (filterSeverity !== "all" && g.severity !== filterSeverity) return false;
    if (filterStatus === "unresolved" && g.isResolved) return false;
    if (filterStatus === "resolved" && !g.isResolved) return false;
    return true;
  });

  const totalUnresolved = allGaps.filter((g) => !g.isResolved).length;
  const totalCritical = allGaps.filter((g) => !g.isResolved && g.severity === "CRITICAL").length;
  const totalHigh = allGaps.filter((g) => !g.isResolved && g.severity === "HIGH").length;
  const totalResolved = allGaps.filter((g) => g.isResolved).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Compliance Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Review, resolve, and annotate compliance gaps before submission packaging.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Unresolved Gaps</p>
          <p className={`mt-1 text-3xl font-bold ${totalUnresolved > 0 ? "text-red-600" : "text-green-600"}`}>{totalUnresolved}</p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Critical / High</p>
          <p className={`mt-1 text-3xl font-bold ${totalCritical + totalHigh > 0 ? "text-red-600" : "text-slate-900"}`}>{totalCritical + totalHigh}</p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Resolved</p>
          <p className="mt-1 text-3xl font-bold text-green-600">{totalResolved}</p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Active Tenders</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{tenders.length}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <select value={filterTender} onChange={(e) => setFilterTender(e.target.value)}
          className="rounded-lg border bg-white px-3 py-2 text-sm">
          <option value="all">All tenders</option>
          {tenders.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
        <select value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value)}
          className="rounded-lg border bg-white px-3 py-2 text-sm">
          <option value="all">All severities</option>
          {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg border bg-white px-3 py-2 text-sm">
          <option value="unresolved">Unresolved</option>
          <option value="resolved">Resolved</option>
          <option value="all">All</option>
        </select>
        <span className="ml-auto self-center text-sm text-slate-500">{filtered.length} gap{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border bg-white p-12 text-center shadow-sm">
          <p className="text-slate-400">{filterStatus === "unresolved" ? "No unresolved compliance gaps — ready for export!" : "No gaps match your filters."}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((gap) => {
            const note = noteMap[gap.id] ?? gap.resolvedNote ?? "";
            const isBusy = resolvingId === gap.id;

            return (
              <div key={gap.id} className={`rounded-2xl border bg-white p-5 shadow-sm ${gap.isResolved ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-block rounded border px-2 py-0.5 text-xs font-bold ${SEVERITY_COLORS[gap.severity] ?? "bg-slate-100 text-slate-600"}`}>
                        {gap.severity}
                      </span>
                      <p className="font-semibold text-slate-900">{gap.title}</p>
                      {gap.isResolved && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">✓ Resolved</span>}
                    </div>
                    <p className="mt-1.5 text-sm text-slate-500 text-xs">{gap.tenderTitle}</p>
                    <p className="mt-2 text-sm text-slate-700">{gap.description}</p>
                    {gap.mitigationPlan && (
                      <p className="mt-1.5 text-xs text-slate-500 italic">Mitigation: {gap.mitigationPlan}</p>
                    )}
                    {gap.isResolved && gap.resolvedNote && (
                      <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
                        <span className="font-medium">Resolution note: </span>{gap.resolvedNote}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Link href={`/dashboard/tenders/${gap.tenderId}`}
                      className="rounded border px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
                      Open
                    </Link>
                    {!gap.isResolved ? (
                      <button
                        onClick={() => toggleGap(gap.tenderId, gap.id, true, note)}
                        disabled={isBusy}
                        className="rounded bg-green-600 px-2.5 py-1.5 text-xs text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        {isBusy ? "…" : "✓ Resolve"}
                      </button>
                    ) : (
                      <button
                        onClick={() => toggleGap(gap.tenderId, gap.id, false, "")}
                        disabled={isBusy}
                        className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                      >
                        {isBusy ? "…" : "Reopen"}
                      </button>
                    )}
                  </div>
                </div>

                {!gap.isResolved && (
                  <div className="mt-3 border-t pt-3">
                    <textarea
                      value={note}
                      onChange={(e) => setNoteMap((m) => ({ ...m, [gap.id]: e.target.value }))}
                      placeholder="Resolution note or evidence description (optional — saved when you click Resolve)"
                      className="w-full rounded-lg border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-300"
                      rows={2}
                    />
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
