"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";

interface ShareEntry {
  id: string;
  token: string;
  label: string | null;
  createdAt: string;
  expiresAt: string | null;
}

interface TenderSharePanelProps {
  tenderId: string;
  canMutate?: boolean;
}

export function TenderSharePanel({ tenderId, canMutate = false }: TenderSharePanelProps) {
  const router = useRouter();
  const [shares, setShares] = useState<ShareEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [newShareUrl, setNewShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const copyInputRef = useRef<HTMLInputElement>(null);

  async function loadShares() {
    try {
      const res = await fetch(`/api/tenders/${tenderId}/share`);
      if (res.ok) {
        const data = await res.json();
        const nextShares = data.shares ?? [];
        setShares(nextShares);
        setOpen(nextShares.length > 0);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadShares();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderId]);

  async function handleGenerate() {
    setGenerating(true);
    setOpen(true);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = await res.json();
        const fullUrl = window.location.origin + data.shareUrl;
        setNewShareUrl(fullUrl);
        await loadShares();
      router.refresh();
      }
    } catch {
      // ignore
    } finally {
      setGenerating(false);
    }
  }

  async function handleRevoke(shareId: string) {
    setRevoking(shareId);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/share`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareId }),
      });
      if (res.ok) {
        setShares((prev) => prev.filter((s) => s.id !== shareId));
        if (newShareUrl) {
          const match = shares.find((s) => s.id === shareId);
          if (match && newShareUrl.includes(match.token)) setNewShareUrl(null);
        }
      }
    } catch {
      // ignore
    } finally {
      setRevoking(null);
    }
  }

  function handleCopy() {
    if (!newShareUrl) return;
    navigator.clipboard.writeText(newShareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const noLinks = !loading && shares.length === 0 && !newShareUrl;

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="block text-base font-semibold text-slate-800">↗ Share Tender</span>
          <span className="block text-xs text-slate-400">{loading ? "Loading share links…" : shares.length > 0 ? `${shares.length} active share link(s)` : "No active share links"}</span>
        </span>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{open ? "Hide" : noLinks ? "Generate" : "Show"}</span>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="mb-3 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate Share Link"}
          </button>

          {newShareUrl && (
            <div className="mb-3 flex items-center gap-2">
              <input
                ref={copyInputRef}
                type="text"
                readOnly
                value={newShareUrl}
                className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-xs text-slate-700 focus:outline-none"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button onClick={handleCopy} className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50">
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          )}

          {loading ? (
            <p className="text-xs text-slate-400">Loading…</p>
          ) : shares.length === 0 ? (
            <p className="text-xs text-slate-400">No active share links.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {shares.map((share) => (
                <div key={share.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="max-w-[180px] truncate font-mono text-xs text-slate-600">{window.location.origin}/share/{share.token}</p>
                    <p className="text-xs text-slate-400">Created {new Date(share.createdAt).toLocaleDateString()}{share.expiresAt ? ` · Expires ${new Date(share.expiresAt).toLocaleDateString()}` : ""}</p>
                  </div>
                  {canMutate && (
                  <button onClick={() => handleRevoke(share.id)} disabled={revoking === share.id} className="shrink-0 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50">
                    {revoking === share.id ? "…" : "Revoke"}
                  </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
