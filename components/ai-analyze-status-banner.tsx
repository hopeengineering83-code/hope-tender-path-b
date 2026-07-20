"use client";

import { CheckCircleIcon, WarningIcon, PlayIcon, RefreshIcon } from "./icons";

type ChunkProgress = {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  isPartial: boolean;
};

type Props = {
  chunks: ChunkProgress | null;
  jobId: string | null;
  isAnalyzing: boolean;
  onContinue: () => void;
  onRetry: () => void;
};

export function AiAnalyzeStatusBanner({ chunks, jobId, isAnalyzing, onContinue, onRetry }: Props) {
  if (!chunks || !jobId) return null;

  const { total, completed, failed, skipped, isPartial } = chunks;

  if (!isPartial) {
    // All chunks complete — show compact green success state
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 flex items-center gap-3">
        <span className="inline-flex items-center gap-1 text-green-600 text-sm font-medium"><CheckCircleIcon /> AI analysis complete</span>
        <span className="text-xs text-green-700">
          {completed} of {total} chunks analyzed
        </span>
      </div>
    );
  }

  // Build detail string for failed/skipped
  const details: string[] = [];
  if (failed > 0) details.push(`${failed} failed`);
  if (skipped > 0) details.push(`${skipped} skipped — deadline reached`);
  const detailStr = details.length > 0 ? ` (${details.join(", ")})` : "";

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1 text-amber-800 font-medium text-sm"><WarningIcon /> Analysis partially complete</span>
          <span className="text-xs text-amber-800">
            {completed} of {total} chunks analyzed{detailStr}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={onContinue}
            disabled={isAnalyzing}
            className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60"
            title="Continue the partial AI Analyze job from where it left off"
          >
            <PlayIcon /> {isAnalyzing ? "Analyzing…" : "Continue AI Analyze"}
          </button>
          <button
            onClick={onRetry}
            disabled={isAnalyzing}
            className="inline-flex items-center gap-1 text-xs text-amber-800 underline hover:text-amber-900 disabled:opacity-60"
            title="Retry AI Analyze from scratch"
          >
            <RefreshIcon /> Retry from scratch
          </button>
        </div>
      </div>
    </div>
  );
}
