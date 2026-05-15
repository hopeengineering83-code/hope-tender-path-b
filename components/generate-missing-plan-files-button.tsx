"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type GenerateResponse = {
  error?: string;
  code?: string;
  nextAction?: string;
  hint?: string;
  warnings?: string[];
  tender?: unknown;
};

function nextActionLabel(action?: string) {
  if (action === "RUN_ENGINE") return "Run Engine first, then retry.";
  if (action === "REVIEW_MATCHES") return "Review/select expert and project evidence, then retry.";
  if (action === "OPEN_EXTRACTION_QUALITY") return "Open Extraction Quality and fix weak files.";
  if (action === "OPEN_ANALYSIS_QUALITY") return "Review Analysis Quality, then retry.";
  if (action === "OPEN_MATCHING_QUALITY") return "Review Matching Quality, then retry.";
  return null;
}

export function GenerateMissingPlanFilesButton({ tenderId, missingCount }: { tenderId: string; missingCount: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);

  async function run() {
    setRunning(true);
    setMessage(null);
    setOk(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/generate`, { method: "POST" });
      const data = await res.json().catch(() => ({ error: "Generation failed: server returned a non-JSON response.", code: "NON_JSON_RESPONSE" })) as GenerateResponse;
      if (!res.ok) {
        const action = nextActionLabel(data.nextAction);
        setOk(false);
        setMessage([data.error || "Generation failed.", action, data.hint].filter(Boolean).join(" "));
        return;
      }
      const warnings = Array.isArray(data.warnings) && data.warnings.length > 0 ? ` Warnings: ${data.warnings.slice(0, 2).join(" ")}` : "";
      setOk(true);
      setMessage(`Generation completed. Reconciliation will refresh.${warnings}`.trim());
      startTransition(() => router.refresh());
    } catch (error) {
      setOk(false);
      setMessage(error instanceof Error ? `Generation failed: ${error.message}` : "Generation failed due to a network/runtime error.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={run}
        disabled={missingCount <= 0 || running || isPending}
        className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running || isPending ? "Generating missing files…" : `Generate ${missingCount} missing planned file${missingCount === 1 ? "" : "s"}`}
      </button>
      {message && <p className={`text-xs ${ok ? "text-emerald-700" : "text-red-700"}`}>{message}</p>}
    </div>
  );
}
