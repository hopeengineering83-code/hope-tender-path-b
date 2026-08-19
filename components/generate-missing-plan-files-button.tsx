"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { emitTenderWorkflowSync } from "../lib/ui/tender-workflow-sync";

type GenerateResponse = {
  success?: boolean;
  error?: string;
  code?: string;
  nextAction?: string;
  hint?: string;
  warning?: string;
  created?: number;
  updated?: number;
  files?: { created?: string[]; updated?: string[]; skipped?: string[] };
};

function nextActionLabel(action?: string) {
  if (action === "RUN_ENGINE") return "Matching has not produced evidence for this tender yet. It runs automatically; retry once it completes.";
  if (action === "REVIEW_MATCHES") return "Open proposal evidence readiness to see why no expert or project evidence could be selected. Selection is automatic once the vault records verify against their documents.";
  if (action === "OPEN_EXTRACTION_QUALITY") return "Open Extraction Quality and fix weak files.";
  if (action === "OPEN_ANALYSIS_QUALITY") return "Review Analysis Quality, then retry.";
  if (action === "OPEN_MATCHING_QUALITY") return "Review Matching Quality, then retry.";
  if (action === "REVIEW_SKIPPED_TARGETS") return "Each target below was skipped for the reason shown — retrying without changing them repeats this result.";
  return null;
}

async function parseResponse(res: Response): Promise<GenerateResponse> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return await res.json() as GenerateResponse;
  const text = await res.text().catch(() => "");
  return {
    error: `Missing-file generation failed: server returned a non-JSON response (${res.status} ${res.statusText || "HTTP error"}).`,
    code: "NON_JSON_RESPONSE",
    hint: text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240) || "Check Vercel function logs.",
  };
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
      const res = await fetch(`/api/tenders/${tenderId}/generate-missing-plan-files`, { method: "POST" });
      const data = await parseResponse(res);
      if (!res.ok || data.error) {
        // A run that changed nothing arrives here with its per-target reasons.
        // Listing them is the point: without them the user is told "0 created"
        // and has nothing to act on except clicking again.
        const action = nextActionLabel(data.nextAction);
        const skipped = data.files?.skipped ?? [];
        setOk(false);
        setMessage([
          data.error || "Missing-file generation failed.",
          action,
          data.hint,
          skipped.length > 0 ? `Skipped: ${skipped.join("; ")}` : null,
        ].filter(Boolean).join(" "));
        return;
      }
      const count = (data.created ?? 0) + (data.updated ?? 0);
      setOk(true);
      setMessage(`${count} missing planned file record${count === 1 ? "" : "s"} created/updated. ${data.warning ?? "Review replacement-control records before export."}`.trim());
      // The Build Plan panel that hosts this button holds its own fetched
      // counts; router.refresh() does not re-run that client fetch, so without
      // this the panel would keep offering "Generate N missing" after N were
      // generated.
      emitTenderWorkflowSync({ tenderId, source: "missing-plan-files-generated" });
      startTransition(() => router.refresh());
    } catch (error) {
      setOk(false);
      setMessage("Missing-file generation failed due to a network/runtime error.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={run}
        disabled={missingCount <= 0 || running || isPending}
        className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {running || isPending ? "Generating missing files…" : `Generate ${missingCount} missing planned file${missingCount === 1 ? "" : "s"}`}
      </button>
      {message && <p className={`text-xs ${ok ? "text-emerald-700" : "text-red-700"}`}>{message}</p>}
    </div>
  );
}
