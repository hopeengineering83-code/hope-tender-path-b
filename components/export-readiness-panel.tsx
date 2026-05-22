"use client";

import { useState } from "react";

type Severity = "HIGH" | "MEDIUM" | "LOW";

type DocumentBlocker = {
  documentId: string;
  name: string;
  fileName: string;
  reasons: string[];
  severity: Severity;
  nextActions: string[];
};

type TenderLevelBlocker = {
  category: string;
  severity: string;
  title: string;
  recommendedAction?: string | null;
};

type ExportReadiness = {
  ok: boolean;
  tender: { id: string; title: string; status: string; stage: string; readinessScore: number };
  summary: { activeDocuments: number; documentBlockers: number; tenderLevelBlockers: number; totalBlockers: number };
  documentBlockers: DocumentBlocker[];
  tenderLevelBlockers: TenderLevelBlocker[];
  message: string;
};

type RepairResult = {
  success?: boolean;
  error?: string;
  repaired?: number;
  skipped?: number;
  plannedCreated?: number;
  letterheadAppliedCount?: number;
  finalExportReady?: boolean;
  remaining?: { documentBlockers?: number; tenderLevelBlockers?: number };
};

const SEVERITY_BADGE: Record<Severity, string> = {
  HIGH: "bg-red-100 text-red-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW: "bg-slate-100 text-slate-600",
};

function severityClass(severity: string): string {
  if (severity === "HIGH" || severity === "CRITICAL") return SEVERITY_BADGE.HIGH;
  if (severity === "MEDIUM") return SEVERITY_BADGE.MEDIUM;
  return SEVERITY_BADGE.LOW;
}

export function ExportReadinessPanel({ tenderId }: { tenderId: string }) {
  const [readiness, setReadiness] = useState<ExportReadiness | null>(null);
  const [loading, setLoading] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repairMessage, setRepairMessage] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/export-readiness`, { method: "GET" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Export readiness failed (${res.status})`);
      setReadiness(data.exportReadiness);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export readiness failed");
    } finally {
      setLoading(false);
    }
  }

  async function repair() {
    setRepairing(true);
    setError(null);
    setRepairMessage(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/repair-export-gaps`, { method: "POST" });
      const data = await res.json().catch(() => ({} as RepairResult));
      if (!res.ok || data.error) throw new Error(data.error ?? `Export repair failed (${res.status})`);
      const remainingDocs = data.remaining?.documentBlockers ?? 0;
      const remainingTender = data.remaining?.tenderLevelBlockers ?? 0;
      setRepairMessage(`Repair completed: ${data.repaired ?? 0} document(s) repaired, ${data.skipped ?? 0} skipped, ${data.plannedCreated ?? 0} planned record(s) created. Remaining blockers: ${remainingDocs + remainingTender}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export repair failed");
    } finally {
      setRepairing(false);
    }
  }

  const ok = readiness?.ok;
  const hasDocumentBlockers = (readiness?.summary.documentBlockers ?? 0) > 0;

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm" id="export-readiness">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Export Readiness Gate</h3>
          <p className="mt-0.5 text-xs text-slate-500">Shows exactly why final ZIP/export is blocked and what to fix next.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {readiness && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
              {ok ? "READY" : `${readiness.summary.totalBlockers} blocker(s)`}
            </span>
          )}
          {readiness && !ok && hasDocumentBlockers && (
            <button
              type="button"
              onClick={() => void repair()}
              disabled={repairing || loading}
              className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
              title="Generate missing final DOCX content, validate generated package files, and mark repaired documents READY_FOR_EXPORT. Tender-level blockers still require manual resolution."
            >
              {repairing ? "Repairing…" : "Repair document gaps"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading || repairing}
            className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? "Checking…" : readiness ? "Re-check" : "Check export gate"}
          </button>
        </div>
      </div>

      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
      {repairMessage && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">{repairMessage}</div>}

      {!readiness && !loading && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
          Run the export gate before final submission to verify generated files, validation, review status, file content, evaluator objections, and pricing leakage controls.
        </div>
      )}

      {readiness && (
        <div className="mt-4 space-y-4">
          <div className={`rounded-xl p-4 ${ok ? "border border-emerald-200 bg-emerald-50" : "border border-red-200 bg-red-50"}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className={`text-sm font-semibold ${ok ? "text-emerald-900" : "text-red-900"}`}>{ok ? "Export gate passed" : "Export gate blocked"}</p>
                <p className={`mt-1 text-xs ${ok ? "text-emerald-700" : "text-red-700"}`}>{readiness.message}</p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-white/70 px-2 py-1"><p className="font-bold text-slate-900">{readiness.summary.activeDocuments}</p><p className="text-slate-500">Docs</p></div>
                <div className="rounded-lg bg-white/70 px-2 py-1"><p className="font-bold text-slate-900">{readiness.summary.documentBlockers}</p><p className="text-slate-500">Doc blockers</p></div>
                <div className="rounded-lg bg-white/70 px-2 py-1"><p className="font-bold text-slate-900">{readiness.summary.tenderLevelBlockers}</p><p className="text-slate-500">Tender blockers</p></div>
              </div>
            </div>
          </div>

          {readiness.tenderLevelBlockers.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Tender-level blockers</p>
              <ul className="mt-2 space-y-2">
                {readiness.tenderLevelBlockers.map((blocker, i) => (
                  <li key={`${blocker.category}-${i}`} className="rounded-lg border border-red-100 bg-white p-3 text-xs">
                    <div className="flex items-start gap-2">
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${severityClass(blocker.severity)}`}>{blocker.severity}</span>
                      <div>
                        <p className="font-medium text-slate-900">{blocker.title}</p>
                        <p className="mt-0.5 text-slate-500">{blocker.category}</p>
                        {blocker.recommendedAction && <p className="mt-1 text-slate-700">Action: {blocker.recommendedAction}</p>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {readiness.documentBlockers.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Document blockers</p>
              <ul className="mt-2 space-y-2">
                {readiness.documentBlockers.map((blocker) => (
                  <li key={blocker.documentId} className="rounded-lg border border-slate-100 bg-white p-3 text-xs">
                    <div className="flex items-start gap-2">
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_BADGE[blocker.severity]}`}>{blocker.severity}</span>
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900">{blocker.fileName}</p>
                        <p className="mt-0.5 text-slate-500">{blocker.name}</p>
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-600">
                          {blocker.reasons.map((reason, i) => <li key={i}>{reason}</li>)}
                        </ul>
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-emerald-700">
                          {blocker.nextActions.map((action, i) => <li key={i}>{action}</li>)}
                        </ul>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
