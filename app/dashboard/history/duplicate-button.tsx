"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function DuplicateButton({ tenderId }: { tenderId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function duplicate() {
    if (!confirm("Duplicate this tender as a new draft?")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/duplicate`, { method: "POST" });
      if (res.ok) {
        const copy = await res.json();
        router.push(`/dashboard/tenders/${copy.id}`);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button onClick={duplicate} disabled={loading}
      className="text-xs text-slate-500 hover:text-slate-800 hover:underline disabled:opacity-40">
      {loading ? "…" : "Duplicate"}
    </button>
  );
}
