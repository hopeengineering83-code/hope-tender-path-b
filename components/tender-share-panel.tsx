"use client";

import { useEffect, useState, useRef } from "react";

interface ShareEntry {
  id: string;
  token: string;
  label: string | null;
  createdAt: string;
  expiresAt: string | null;
}

interface TenderSharePanelProps {
  tenderId: string;
}

export function TenderSharePanel({ tenderId }: TenderSharePanelProps) {
  const [shares, setShares] = useState<ShareEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [newShareUrl, setNewShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const copyInputRef = useRef<HTMLInputElement>(null);

  async function loadShares() {
    try {
      const res = await fetch(`/api/tenders/${tenderId}/share`);
      if (res.ok) {
        const data = await res.json();
        setShares(data.shares ?? []);
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
        // Clear new share URL if the revoked share matches
        if (newShareUrl) {
          const match = shares.find((s) => s.id === shareId);
          if (match && newShareUrl.includes(match.token)) {
            setNewShareUrl(null);
          }
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

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base font-semibold text-slate-800">&#8599; Share Tender</span>
      </div>

      <button
        onClick={handleGenerate}
        disabled={generating}
        className="mb-3 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
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
            className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 font-mono focus:outline-none"
            onClick={(e) => (e.target as HTMLInputElement).select()}
          />
          <button
            onClick={handleCopy}
            className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
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
            <div key={share.id} className="py-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-mono text-slate-600 truncate max-w-[180px]">
                  {window.location.origin}/share/{share.token}
                </p>
                <p className="text-xs text-slate-400">
                  Created {new Date(share.createdAt).toLocaleDateString()}
                  {share.expiresAt ? ` · Expires ${new Date(share.expiresAt).toLocaleDateString()}` : ""}
                </p>
              </div>
              <button
                onClick={() => handleRevoke(share.id)}
                disabled={revoking === share.id}
                className="shrink-0 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                {revoking === share.id ? "…" : "Revoke"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
