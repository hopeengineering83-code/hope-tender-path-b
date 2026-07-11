"use client";

// Client island for the CorruptedMetadataBanner. Calls the re-extract
// endpoint and surfaces the per-field outcome — specifically whether
// the route's new overwrite-invalid logic (commit 7688111) succeeded
// in cleaning the previously-corrupted fields.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type ReExtractResponse = {
  success?: boolean;
  updated?: number;
  overwrittenInvalid?: string[];
  message?: string;
  error?: string;
};

export function RepairTenderFactsButton({ tenderId, badCount }: { tenderId: string; badCount: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [kind, setKind] = useState<"success" | "error" | "info">("info");

  async function clean() {
    setRunning(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/re-extract-metadata`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as ReExtractResponse;
      if (!res.ok || !data.success) {
        setKind("error");
        setFeedback(data.error ?? `Re-extract failed (HTTP ${res.status}).`);
        return;
      }
      const overwritten = data.overwrittenInvalid ?? [];
      if (overwritten.length === 0 && (data.updated ?? 0) === 0) {
        setKind("info");
        setFeedback("Re-extract ran but the extractor did not find replacement values in the stored PDF text. Try uploading a clearer copy of the tender, or edit the fields manually.");
      } else if (overwritten.length > 0) {
        setKind("success");
        setFeedback(`Cleaned ${overwritten.length} corrupted field${overwritten.length === 1 ? "" : "s"}: ${overwritten.join(", ")}.`);
      } else {
        setKind("success");
        setFeedback(`Filled ${data.updated} previously empty field(s). Refreshing…`);
      }
      startTransition(() => router.refresh());
    } catch (error) {
      setKind("error");
      setFeedback(error instanceof Error ? `Re-extract failed: ${error.message}` : "Re-extract failed due to a network/runtime error.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={clean}
        disabled={running || isPending}
        title="Re-runs the Tender Details extractor against the stored PDF text. Only invalid stored values are overwritten — valid manual edits are preserved."
        className="self-start rounded-lg bg-red-700 px-5 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {running || isPending ? "Cleaning…" : `Clean now (${badCount})`}
      </button>
      {feedback && (
        <div className={`rounded-lg border px-3 py-2 text-xs ${kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : kind === "error" ? "border-red-300 bg-white text-red-700" : "border-slate-200 bg-white text-slate-700"}`}>
          {feedback}
        </div>
      )}
    </div>
  );
}

// Backward-compat alias — use RepairTenderFactsButton in new code.
export const CleanCorruptedMetadataButton = RepairTenderFactsButton;
