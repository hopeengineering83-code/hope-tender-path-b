"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DeleteTenderButton } from "../../../components/delete-tender-button";

export function DuplicateButton({ tenderId }: { tenderId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function duplicate() {
    if (!confirm("Duplicate this tender as a new draft?")) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/tenders/${tenderId}/duplicate`, { method: "POST" });
      if (response.ok) {
        const copy = await response.json();
        router.push(`/dashboard/tenders/${copy.id}`);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void duplicate()}
        disabled={loading}
        className="min-h-9 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-60"
      >
        {loading ? "Duplicating…" : "Duplicate"}
      </button>
      <DeleteTenderButton tenderId={tenderId} compact />
    </div>
  );
}
