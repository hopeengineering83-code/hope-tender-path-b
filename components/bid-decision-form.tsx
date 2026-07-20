"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CrossIcon } from "./icons";

type Decision = "BID" | "BID_WITH_CONDITIONS" | "NO_BID";

type BidDecisionResult = {
  decision: Decision;
  score: number;
  summary: string;
  blockers: string[];
  conditions: string[];
};

type BidDecisionResponse = {
  success?: boolean;
  decision?: BidDecisionResult;
  error?: string;
};

export function BidDecisionForm({ tenderId }: { tenderId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluated, setEvaluated] = useState<BidDecisionResult | null>(null);
  const [override, setOverride] = useState<Decision | "">("");
  const [overrideReason, setOverrideReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ decision: Decision; summary: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const evaluate = async () => {
    setEvaluating(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/bid-decision`);
      const json = await res.json() as BidDecisionResponse;
      if (!res.ok || !json.success || !json.decision) {
        setError(json.error ?? "Evaluation failed");
        return;
      }
      setEvaluated(json.decision);
    } catch {
      setError("Network error during evaluation");
    } finally {
      setEvaluating(false);
    }
  };

  const submit = async () => {
    if (!evaluated) return;
    if (override && !overrideReason.trim()) {
      setError("Override reason is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: { overrideDecision?: string; overrideReason?: string } = {};
      if (override) { body.overrideDecision = override; body.overrideReason = overrideReason; }
      const res = await fetch(`/api/tenders/${tenderId}/bid-decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json() as BidDecisionResponse;
      if (!res.ok || !json.success || !json.decision) {
        setError(json.error ?? "Failed to record decision");
        return;
      }
      setResult({ decision: json.decision.decision, summary: json.decision.summary });
      setOpen(false);
      router.refresh();
    } catch {
      setError("Network error recording decision");
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    const color = result.decision === "BID" ? "text-emerald-700 bg-emerald-50 border-emerald-200" : result.decision === "BID_WITH_CONDITIONS" ? "text-amber-700 bg-amber-50 border-amber-200" : "text-slate-700 bg-slate-50 border-slate-200";
    return (
      <div className={`mt-3 rounded-lg border px-4 py-3 text-sm ${color}`}>
        <span className="font-semibold">Bid decision recorded: {result.decision.replace(/_/g, " ")}</span>
        <p className="mt-1 text-xs opacity-80">{result.summary}</p>
      </div>
    );
  }

  return (
    <div className="mt-3">
      {!open ? (
        <button
          onClick={() => { setOpen(true); void evaluate(); }}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Evaluate &amp; Record Bid Decision
        </button>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-slate-900">Record Bid Decision</p>
            <button onClick={() => setOpen(false)} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"><CrossIcon /> Close</button>
          </div>

          {evaluating && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              Evaluating bid readiness…
            </div>
          )}

          {evaluated && (
            <div className="space-y-3">
              <div className={`rounded-lg border px-3 py-2 text-sm ${evaluated.decision === "BID" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : evaluated.decision === "BID_WITH_CONDITIONS" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold">Evaluated: {evaluated.decision.replace(/_/g, " ")}</span>
                  <span className="text-xs">{evaluated.score}/100</span>
                </div>
                <p className="mt-1 text-xs">{evaluated.summary}</p>
              </div>

              {evaluated.blockers.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-red-700">
                  {evaluated.blockers.slice(0, 5).map((b) => <li key={b}>{b}</li>)}
                </ul>
              )}

              {evaluated.conditions.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-700">
                  {evaluated.conditions.slice(0, 5).map((c) => <li key={c}>{c}</li>)}
                </ul>
              )}

              <div>
                <label className="text-xs font-medium text-slate-600">Override decision (optional)</label>
                <select
                  value={override}
                  onChange={(e) => setOverride(e.target.value as Decision | "")}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                >
                  <option value="">Use evaluated decision ({evaluated.decision.replace(/_/g, " ")})</option>
                  <option value="BID">BID</option>
                  <option value="BID_WITH_CONDITIONS">BID WITH CONDITIONS</option>
                  <option value="NO_BID">NO BID</option>
                </select>
              </div>

              {override && (
                <div>
                  <label className="text-xs font-medium text-slate-600">Override reason (required)</label>
                  <textarea
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    rows={2}
                    placeholder="Explain why you are overriding the evaluated decision…"
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                  />
                </div>
              )}

              {error && <p className="text-xs text-red-600">{error}</p>}

              <button
                onClick={() => void submit()}
                disabled={submitting}
                className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-60"
              >
                {submitting ? "Recording…" : `Record ${override ? override.replace(/_/g, " ") : evaluated.decision.replace(/_/g, " ")} Decision`}
              </button>
            </div>
          )}

          {error && !evaluated && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
