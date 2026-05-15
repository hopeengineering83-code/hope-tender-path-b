"use client";

// Re-extract metadata button — client component embedded in the
// TenderIntakeDetailPanel. Calls the /re-extract-metadata endpoint
// and reloads the page on success so the new fields appear.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReExtractMetadataButton({ tenderId }: { tenderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/re-extract-metadata`, { method: "POST" });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        setError((data.error as string) || "Re-extraction failed");
        return;
      }
      setMessage((data.message as string) || `Updated ${data.updated} field(s)`);
      // Refresh the page so the panel re-renders with the new values.
      if (typeof data.updated === "number" && data.updated > 0) {
        setTimeout(() => router.refresh(), 800);
      }
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {busy ? "Re-extracting…" : "Re-extract from PDF"}
      </button>
      {message && <div className="text-xs text-green-700">{message}</div>}
      {error && <div className="text-xs text-red-700 max-w-xs text-right">{error}</div>}
    </div>
  );
}
