"use client";

// Version restore + preview + diff client component for the Command Center.
// Server component cannot run client-side interactions, so restore and
// preview live here. Receives version metadata from the server component.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, CrossIcon } from "../../../../../components/icons";

type VersionMeta = {
  id: string;
  version: number;
  qualityScore: number | null;
  winProbabilityScore: number | null;
  mode: string | null;
  createdAt: Date | string;
};

type DiffHunk = { type: "add" | "remove" | "context"; lines: string[] };
type DiffResult = { baseVersion: number; compareVersion: number; added: number; removed: number; hunks: DiffHunk[] };

export function VersionActionsTable({ versions, tenderId }: { versions: VersionMeta[]; tenderId: string }) {
  const router = useRouter();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewMarkdown, setPreviewMarkdown] = useState<string>("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Diff state
  const [diffBaseId, setDiffBaseId] = useState<string | null>(null);
  const [diffCompareId, setDiffCompareId] = useState<string>("");
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  async function loadPreview(versionId: string) {
    setLoadingPreview(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/proposal-versions/${versionId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load version");
      setPreviewMarkdown(data.version?.markdown ?? "(No markdown content)");
      setPreviewId(versionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function restore(versionId: string) {
    setRestoringId(versionId);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/proposal-versions/${versionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Restore failed");
      setConfirmRestoreId(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setRestoringId(null);
    }
  }

  async function loadDiff(baseId: string, compareId: string) {
    if (!compareId) return;
    setLoadingDiff(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/proposal-versions/${baseId}/diff?compare_to=${compareId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Diff failed");
      setDiffResult(data as DiffResult);
      setShowDiff(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Diff failed");
    } finally {
      setLoadingDiff(false);
    }
  }

  if (versions.length === 0) {
    return <p className="text-sm text-slate-400 py-2">No proposal versions saved yet. Run the engine to create the first version.</p>;
  }

  return (
    <>
      {error && (
        <div className="mb-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {error}
          <button onClick={() => setError(null)} aria-label="Dismiss error" className="ml-2 text-red-400 hover:text-red-600"><CrossIcon /></button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border border-slate-200 rounded-lg border-collapse bg-white text-sm">
          <thead>
            <tr className="bg-slate-50">
              <th className="text-left px-3 py-2 text-xs text-slate-500 font-medium border-b border-slate-200">Version</th>
              <th className="text-left px-3 py-2 text-xs text-slate-500 font-medium border-b border-slate-200">Quality</th>
              <th className="text-left px-3 py-2 text-xs text-slate-500 font-medium border-b border-slate-200">Win Prob.</th>
              <th className="text-left px-3 py-2 text-xs text-slate-500 font-medium border-b border-slate-200 hidden sm:table-cell">Mode</th>
              <th className="text-left px-3 py-2 text-xs text-slate-500 font-medium border-b border-slate-200 hidden md:table-cell">Created</th>
              <th className="text-left px-3 py-2 text-xs text-slate-500 font-medium border-b border-slate-200">Actions</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-3 py-2 font-semibold text-slate-800">v{v.version}</td>
                <td className="px-3 py-2">
                  {v.qualityScore != null ? (
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${v.qualityScore >= 85 ? "bg-green-100 text-green-800" : v.qualityScore >= 65 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"}`}>
                      {v.qualityScore}/100
                    </span>
                  ) : "—"}
                </td>
                <td className="px-3 py-2">
                  {v.winProbabilityScore != null ? (
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${v.winProbabilityScore >= 65 ? "bg-blue-100 text-blue-800" : v.winProbabilityScore >= 45 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"}`}>
                      {v.winProbabilityScore}%
                    </span>
                  ) : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500 max-w-[120px] truncate hidden sm:table-cell">{v.mode ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-slate-500 hidden md:table-cell">{new Date(v.createdAt).toLocaleString()}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => void loadPreview(v.id)}
                      disabled={loadingPreview && previewId !== v.id}
                      className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-60"
                    >
                      {loadingPreview && previewId === v.id ? "Loading…" : "Preview"}
                    </button>
                    {versions.length > 1 && (
                      <button
                        onClick={() => { setDiffBaseId(v.id); setDiffCompareId(""); setDiffResult(null); setShowDiff(false); }}
                        className="rounded border border-indigo-200 px-2 py-0.5 text-xs text-indigo-700 hover:bg-indigo-50"
                      >
                        Compare
                      </button>
                    )}
                    {confirmRestoreId === v.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => void restore(v.id)}
                          disabled={restoringId === v.id}
                          className="rounded bg-amber-600 px-2 py-0.5 text-xs text-white hover:bg-amber-700 disabled:opacity-60"
                        >
                          {restoringId === v.id ? "Restoring…" : "Confirm"}
                        </button>
                        <button onClick={() => setConfirmRestoreId(null)} className="rounded border px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmRestoreId(v.id)}
                        className="rounded border border-amber-200 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-50"
                      >
                        Restore
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Compare picker */}
      {diffBaseId && !showDiff && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs">
          <span className="text-indigo-700 font-medium">
            Compare v{versions.find((v) => v.id === diffBaseId)?.version} against:
          </span>
          <select
            value={diffCompareId}
            onChange={(e) => setDiffCompareId(e.target.value)}
            className="rounded border border-indigo-200 bg-white px-2 py-0.5 text-xs text-slate-700"
          >
            <option value="">Select version…</option>
            {versions.filter((v) => v.id !== diffBaseId).map((v) => (
              <option key={v.id} value={v.id}>v{v.version} — {new Date(v.createdAt).toLocaleDateString()}</option>
            ))}
          </select>
          <button
            onClick={() => void loadDiff(diffBaseId, diffCompareId)}
            disabled={!diffCompareId || loadingDiff}
            className="rounded bg-indigo-600 px-2 py-0.5 text-xs text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {loadingDiff ? "Loading…" : "Show Diff"}
          </button>
          <button onClick={() => setDiffBaseId(null)} aria-label="Close diff view" className="text-indigo-400 hover:text-indigo-600"><CrossIcon /></button>
        </div>
      )}

      {/* Preview modal */}
      {previewId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="relative w-full max-w-4xl max-h-[85vh] flex flex-col bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Version {versions.find((v) => v.id === previewId)?.version ?? "?"} — Preview
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Read-only. Use Restore to make this the active proposal.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setConfirmRestoreId(previewId)}
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
                >
                  Restore this version
                </button>
                <button
                  onClick={() => { setPreviewId(null); setPreviewMarkdown(""); }}
                  className="rounded-lg border px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4">
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-700 bg-slate-50 rounded-lg p-4">
                {previewMarkdown}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Diff modal */}
      {showDiff && diffResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="relative w-full max-w-5xl max-h-[90vh] flex flex-col bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  v{diffResult.baseVersion} <ArrowRightIcon /> v{diffResult.compareVersion} — What changed
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  <span className="text-emerald-600 font-medium">+{diffResult.added} added</span>
                  {" · "}
                  <span className="text-red-500 font-medium">−{diffResult.removed} removed</span>
                  {" · "}
                  {diffResult.hunks.length === 0 ? "No differences" : `${diffResult.hunks.length} change block(s)`}
                </p>
              </div>
              <button
                onClick={() => { setShowDiff(false); setDiffBaseId(null); setDiffResult(null); }}
                className="rounded-lg border px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4 font-mono text-xs leading-relaxed">
              {diffResult.hunks.length === 0 ? (
                <p className="text-slate-400 py-8 text-center">These two versions are identical.</p>
              ) : (
                diffResult.hunks.map((hunk, i) => (
                  <div key={i} className={`rounded px-3 py-1 mb-0.5 whitespace-pre-wrap ${hunk.type === "add" ? "bg-emerald-50 text-emerald-900" : hunk.type === "remove" ? "bg-red-50 text-red-900" : "bg-slate-50 text-slate-500"}`}>
                    {hunk.lines.map((line, j) => (
                      <div key={j}>
                        {hunk.type === "add" ? "+ " : hunk.type === "remove" ? "− " : "  "}
                        {line}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
