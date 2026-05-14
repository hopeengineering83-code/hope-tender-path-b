"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type GenerationReadiness = {
  ready: boolean;
  blockers?: Array<{ code: string; message: string; nextAction?: string }>;
  warnings?: Array<{ code: string; message: string; nextAction?: string }>;
  counts?: {
    selectedExperts?: number;
    reviewedExpertMatches?: number;
    selectedProjects?: number;
    reviewedProjectMatches?: number;
  };
};

type GenerateResponse = {
  error?: string;
  code?: string;
  nextAction?: string;
  warnings?: string[];
  tender?: unknown;
};

function shortAction(action?: string): string {
  if (action === "RUN_ENGINE") return "Run Engine first.";
  if (action === "REVIEW_MATCHES") return "Review/select matching evidence.";
  if (action === "OPEN_KNOWLEDGE_REVIEW") return "Open the Knowledge Review board.";
  if (action === "OPEN_COMPANY_READINESS") return "Open Company Readiness.";
  if (action === "OPEN_ANALYSIS_QUALITY") return "Review Analysis Quality.";
  if (action === "OPEN_MATCHING_QUALITY") return "Review Matching Quality.";
  return "Review the tender readiness panels.";
}

export function GenerationActionPanel({ tenderId, readiness }: { tenderId: string; readiness: GenerationReadiness | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [kind, setKind] = useState<"success" | "error" | "info">("info");

  const blockers = readiness?.blockers ?? [];
  const warnings = readiness?.warnings ?? [];
  const ready = Boolean(readiness?.ready);
  const autoPromotionAvailable = Boolean(
    readiness?.counts
    && ((readiness.counts.selectedExperts ?? 0) === 0 && (readiness.counts.reviewedExpertMatches ?? 0) > 0
      || (readiness.counts.selectedProjects ?? 0) === 0 && (readiness.counts.reviewedProjectMatches ?? 0) > 0),
  );

  async function runGenerate() {
    setRunning(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/generate`, { method: "POST" });
      const data = await res.json().catch(() => ({})) as GenerateResponse;
      if (!res.ok) {
        const hint = data.nextAction ? ` ${shortAction(data.nextAction)}` : "";
        setKind("error");
        setMessage(`${data.error || "Generation failed."}${hint}`.trim());
        return;
      }
      const warningText = Array.isArray(data.warnings) && data.warnings.length > 0 ? ` Warnings: ${data.warnings.slice(0, 2).join(" ")}` : "";
      setKind("success");
      setMessage(`Generation completed.${warningText}`.trim());
      startTransition(() => router.refresh());
    } catch (error) {
      setKind("error");
      setMessage(error instanceof Error ? `Generation failed. ${error.message}` : "Generation failed due to a network/runtime error.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${ready ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide ${ready ? "text-emerald-700" : "text-amber-700"}`}>Generation action</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">{ready ? "Server readiness gate allows generation" : "Resolve generation blockers first"}</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            This action follows the server-side generation-readiness gate, including reviewed-match auto-promotion. It avoids stale client-side disable logic.
          </p>
          {autoPromotionAvailable && (
            <p className="mt-2 text-xs font-medium text-emerald-700">Reviewed matches are available for automatic promotion if no manual selection has been made.</p>
          )}
        </div>
        <button
          onClick={runGenerate}
          disabled={!ready || running || isPending}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running || isPending ? "Generating…" : "Generate Docs"}
        </button>
      </div>

      {!ready && blockers.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-800">
          {blockers.slice(0, 4).map((item, index) => <li key={`${item.code}-${index}`}>{item.message}</li>)}
        </ul>
      )}
      {ready && warnings.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-emerald-800">
          {warnings.slice(0, 3).map((item, index) => <li key={`${item.code}-${index}`}>{item.message}</li>)}
        </ul>
      )}
      {message && (
        <div className={`mt-3 rounded-xl border px-3 py-2 text-sm ${kind === "success" ? "border-emerald-200 bg-white text-emerald-800" : kind === "error" ? "border-red-200 bg-white text-red-700" : "border-slate-200 bg-white text-slate-700"}`}>
          {message}
        </div>
      )}
    </section>
  );
}
