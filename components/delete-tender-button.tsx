"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TrashIcon } from "./icons";

type Props = {
  tenderId: string;
  tenderTitle?: string;
  compact?: boolean;
};

export function DeleteTenderButton({ tenderId, tenderTitle = "this tender", compact = false }: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function permanentlyDelete() {
    if (deleting) return;
    const confirmation = window.prompt(
      `Permanently delete “${tenderTitle}” and all of its files, jobs, matches, and generated outputs? Type DELETE to continue.`,
    );
    if (confirmation !== "DELETE") return;

    setDeleting(true);
    setError("");
    window.dispatchEvent(new CustomEvent("tender-deletion-started", { detail: { tenderId } }));
    try {
      const response = await fetch(`/api/tenders/${tenderId}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Permanent deletion failed (HTTP ${response.status}).`);
      window.dispatchEvent(new CustomEvent("tender-deleted", {
        detail: { tenderId, storageCleanupPending: Boolean(body.storageCleanupPending) },
      }));
      router.replace(`/dashboard/tenders?deleted=${encodeURIComponent(tenderTitle)}${body.storageCleanupPending ? "&cleanup=pending" : ""}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Permanent deletion failed.");
      setDeleting(false);
    }
  }

  // Compact mode renders an icon-only button. The previous "Permanently delete"
  // text label forced the tenders list Action column past its available width
  // at 800px tablet viewport, causing a 16px horizontal overflow that broke
  // the responsive regression guards. The full verb is still exposed via
  // aria-label (screen readers) and title (hover tooltip), so the action is
  // never ambiguous — only the visible glyph is compressed.
  if (compact) {
    return (
      <div className="inline-flex flex-col items-end">
        <button
          type="button"
          onClick={() => void permanentlyDelete()}
          disabled={deleting}
          aria-busy={deleting}
          aria-label={`Permanently delete ${tenderTitle}`}
          title="Permanently delete"
          className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-red-200 px-2 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
        >
          {deleting ? <span className="text-xs">…</span> : <TrashIcon />}
        </button>
        {error ? <p className="mt-1 max-w-xs text-right text-xs text-red-700" role="alert">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        onClick={() => void permanentlyDelete()}
        disabled={deleting}
        aria-busy={deleting}
        className="inline-flex min-h-11 items-center rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
      >
        {deleting ? "Deleting permanently…" : "Permanently delete"}
      </button>
      {error ? <p className="mt-1 max-w-xs text-right text-xs text-red-700" role="alert">{error}</p> : null}
    </div>
  );
}
