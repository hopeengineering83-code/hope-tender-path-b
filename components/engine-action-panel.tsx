"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type ExtractionBlocker = {
  fileName?: string;
  quality?: {
    severity?: string;
    score?: number;
    warnings?: string[];
    blockers?: string[];
  };
};

type EngineResponse = {
  success?: boolean;
  error?: string;
  code?: string;
  nextAction?: string;
  hint?: string;
  detail?: string;
  diagnosticId?: string;
  blockers?: ExtractionBlocker[];
  extractionWarnings?: ExtractionBlocker[];
  tender?: unknown;
};

function actionLabel(action?: string) {
  if (action === "UPLOAD_TENDER_DOCUMENT") return "Upload the tender/RFP document, then run Engine.";
  if (action === "OPEN_EXTRACTION_QUALITY") return "Open Extraction Quality and fix/OCR weak files.";
  if (action === "RETRY_OR_REDUCE_INPUT") return "Retry, or reduce duplicate/oversized tender inputs.";
  if (action === "RETRY_AFTER_DATABASE_CHECK") return "Check database/Vercel runtime, then retry.";
  if (action === "OPEN_TENDER_LIST") return "Return to tender list and reopen this tender.";
  if (action === "LOGIN_AGAIN") return "Sign in again, then retry.";
  if (action === "OPEN_EXTRACTION_ANALYSIS_MATCHING_QUALITY") return "Review Extraction, Analysis, and Matching Quality panels.";
  return null;
}

async function parseEngineResponse(res: Response): Promise<EngineResponse> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await res.json() as EngineResponse;
  }
  const text = await res.text().catch(() => "");
  const clean = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 320);
  return {
    error: `Engine run failed: server returned a non-JSON response (${res.status} ${res.statusText || "HTTP error"}).`,
    code: "NON_JSON_RESPONSE",
    detail: clean || "No response body was returned. Check Vercel function logs for this request.",
    nextAction: res.status === 401 ? "LOGIN_AGAIN" : "RETRY_AFTER_DATABASE_CHECK",
    hint: "This usually means the route crashed before returning JSON, authentication redirected, or the deployment is serving an error page.",
  };
}

export function EngineActionPanel({ tenderId }: { tenderId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<EngineResponse | null>(null);

  async function runEngine(force = false) {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/engine${force ? "?force=true" : ""}`, { method: "POST" });
      const data = await parseEngineResponse(res);
      if (!res.ok) {
        setResult(data);
        return;
      }
      setResult({ ...data, success: true, error: "Engine completed successfully." });
      startTransition(() => router.refresh());
    } catch (error) {
      setResult({
        error: error instanceof Error ? `Engine run failed: ${error.message}` : "Engine run failed due to a network/runtime error.",
        code: "NETWORK_OR_RUNTIME_ERROR",
        nextAction: "RETRY_OR_REDUCE_INPUT",
      });
    } finally {
      setRunning(false);
    }
  }

  const ok = result?.success === true;
  const action = actionLabel(result?.nextAction);
  const extractionBlocked = result?.code === "EXTRACTION_NOT_READY";

  return (
    <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Run Engine control</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">Run tender engine with structured diagnostics</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Use this panel for Run Engine. It displays error code, next action, hint, detail, extraction blockers, and diagnostic ID from the backend.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {extractionBlocked && (
            <button
              onClick={() => runEngine(true)}
              disabled={running || isPending}
              className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Force run once
            </button>
          )}
          <button
            onClick={() => runEngine(false)}
            disabled={running || isPending}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running || isPending ? "Running…" : "Run Engine"}
          </button>
        </div>
      </div>

      {result && (
        <div className={`mt-4 rounded-xl border p-4 text-sm ${ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{result.error ?? (ok ? "Engine completed." : "Engine failed.")}</p>
            {result.code && <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold">{result.code}</span>}
            {result.diagnosticId && <span className="rounded-full bg-white px-2 py-0.5 text-xs font-mono">{result.diagnosticId}</span>}
          </div>
          {action && <p className="mt-2"><strong>Next action:</strong> {action}</p>}
          {result.hint && <p className="mt-1"><strong>Hint:</strong> {result.hint}</p>}
          {result.detail && <p className="mt-1"><strong>Detail:</strong> {result.detail}</p>}

          {Array.isArray(result.blockers) && result.blockers.length > 0 && (
            <div className="mt-3 rounded-lg bg-white p-3">
              <p className="font-semibold">Extraction blockers</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {result.blockers.slice(0, 5).map((blocker, index) => (
                  <li key={`${blocker.fileName ?? "file"}-${index}`}>
                    {blocker.fileName ?? "File"}: {blocker.quality?.severity ?? "blocked"}
                    {typeof blocker.quality?.score === "number" ? ` (${blocker.quality.score}/100)` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
