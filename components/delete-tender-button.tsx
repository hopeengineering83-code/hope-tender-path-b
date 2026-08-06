"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  tenderId: string;
  tenderTitle: string;
  compact?: boolean;
};

export function DeleteTenderButton({ tenderId, tenderTitle, compact = false }: Props) {
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

  return (
    <div className={compact ? "inline-flex flex-col items-end" : "flex flex-col items-end"}>
      <button
        type="button"
        onClick={() => void permanentlyDelete()}
        disabled={deleting}
        aria-busy={deleting}
        className={compact
          ? "inline-flex min-h-11 items-center rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
          : "inline-flex min-h-11 items-center rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"}
      >
        {deleting ? "Deleting permanently…" : "Permanently delete"}
      </button>
      {error ? <p className="mt-1 max-w-xs text-right text-xs text-red-700" role="alert">{error}</p> : null}
    </div>
  );
}
