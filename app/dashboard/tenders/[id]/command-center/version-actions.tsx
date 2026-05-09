"use client";

// Version restore + preview client component for the Command Center.
// Server component cannot run client-side interactions, so restore and
// preview live here. Receives version metadata from the server component.

import { useState } from "react";
import { useRouter } from "next/navigation";

type VersionMeta = {
  id: string;
  version: number;
  qualityScore: number | null;
  winProbabilityScore: number | null;
  mode: string | null;
  createdAt: Date | string;
};

export function VersionActionsTable({ versions, tenderId }: { versions: VersionMeta[]; tenderId: string }) {
  const router = useRouter();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewMarkdown, setPreviewMarkdown] = useState<string>("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (versions.length === 0) {
    return <p className="text-sm text-slate-400 py-2">No proposal versions saved yet. Run the engine to create the first version.</p>;
  }

  return (
    <>
      {error && (
        <div className="mb-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
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
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void loadPreview(v.id)}
                      disabled={loadingPreview && previewId !== v.id}
                      className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                    >
                      {loadingPreview && previewId === v.id ? "Loading…" : "Preview"}
                    </button>
                    {confirmRestoreId === v.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => void restore(v.id)}
                          disabled={restoringId === v.id}
                          className="rounded bg-amber-600 px-2 py-0.5 text-xs text-white hover:bg-amber-700 disabled:opacity-50"
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
                        className="rounded border border-amber-200 px-2 py-0.5 text-xs text-amber-700 hover:bg-amber-50"
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
    </>
  );
}
