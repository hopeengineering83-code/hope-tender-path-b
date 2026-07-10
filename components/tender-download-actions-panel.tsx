"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DownloadIcon, CrossIcon } from "./icons";

export function TenderDownloadActionsPanel({ tenderId, canMutate = false }: { tenderId: string; canMutate?: boolean }) {
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    if (!confirm("Delete this tender and all generated documents? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/tenders/${tenderId}`, { method: "DELETE" });
      if (res.ok) router.push("/dashboard/tenders");
      else {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? "Failed to delete tender.");
      }
    } catch {
      alert("Network error — could not delete tender.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2 py-3">
      <a
        href={`/api/tenders/${tenderId}/download?type=proposal`}
        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-slate-50"
        title="Download the proposal document"
      >
        <DownloadIcon /> Proposal
      </a>
      <a
        href={`/api/tenders/${tenderId}/download?type=requirements`}
        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-slate-50"
        title="Download the requirements list"
      >
        <DownloadIcon /> Requirements
      </a>
      <a
        href={`/api/tenders/${tenderId}/download?type=compliance`}
        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-slate-50"
        title="Download the compliance report"
      >
        <DownloadIcon /> Compliance Report
      </a>
      {canMutate && (
      <button
        onClick={handleDelete}
        disabled={deleting}
        className="inline-flex items-center gap-1.5 ml-auto rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
        title="Delete this tender and all generated documents"
      >
        <CrossIcon /> {deleting ? "Deleting…" : "Delete tender"}
      </button>
      )}
    </div>
  );
}
