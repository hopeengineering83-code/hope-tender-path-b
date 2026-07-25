"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { severityBadgeClassesCompact, severityToUISeverity } from "../lib/ui-tokens";

type Priority = "HIGH" | "MEDIUM" | "LOW";
type Owner = "TECHNICAL" | "COMPLIANCE" | "COMMERCIAL" | "PROPOSAL" | "MANAGEMENT";

type CopilotResponse = {
  answer: string;
  recommendations: string[];
  evidenceReferences?: string[];
  risks: Array<{ title: string; severity: Priority; detail: string }>;
  nextActions: Array<{ title: string; owner: Owner; priority: Priority; detail: string }>;
  confidence: Priority;
};

// SEVERITY_BADGE migrated to lib/ui-tokens.ts::severityBadgeClassesCompact(severityToUISeverity(...)).
// Single source of truth for severity color mapping across all panels.
// OWNER_BADGE remains local because OWNER isn't a severity — it's a category
// (TECHNICAL/COMPLIANCE/COMMERCIAL/PROPOSAL/MANAGEMENT) and doesn't map to
// the canonical 8-state UISeverity model.

const OWNER_BADGE: Record<Owner, string> = {
  TECHNICAL: "bg-blue-100 text-blue-700",
  COMPLIANCE: "bg-purple-100 text-purple-700",
  COMMERCIAL: "bg-emerald-100 text-emerald-700",
  PROPOSAL: "bg-slate-100 text-slate-700",
  MANAGEMENT: "bg-orange-100 text-orange-700",
};

const QUICK_QUESTIONS = [
  "What are the highest-risk issues before submission?",
  "Which selected experts or projects look weak against the tender scope?",
  "What should we fix first to improve evaluator score?",
  "Is this tender ready for final export?",
  "What compliance items could disqualify us?",
];

export function TenderAICopilotPanel({ tenderId, canMutate = false }: { tenderId: string; canMutate?: boolean }) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState<CopilotResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordedCount, setRecordedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(q = question) {
    if (!canMutate) return;
    const trimmed = q.trim();
    if (trimmed.length < 3) return;
    setLoading(true);
    setError(null);
    setRecordedCount(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/copilot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Copilot failed (${res.status})`);
      setResponse(data.response);
      setQuestion(trimmed);
    } catch (err) {
      setError("Copilot failed".replace("failed", "failed. Refresh to retry."));
    } finally {
      setLoading(false);
    }
  }

  async function recordControls() {
    if (!canMutate) return;
    if (!response) return;
    setRecording(true);
    setError(null);
    let count = 0;
    try {
      for (const action of response.nextActions) {
        const res = await fetch(`/api/tenders/${tenderId}/controls`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "TASK",
            title: action.title,
            description: action.detail,
            owner: action.owner,
            priority: action.priority,
            status: "OPEN",
            sourceReference: "Tender AI Copilot",
            impact: `Confidence ${response.confidence}`,
            metadata: { source: "copilot", question },
          }),
        });
        if (!res.ok) throw new Error(`Failed to record task: ${action.title}`);
        count += 1;
      }
      for (const risk of response.risks) {
        const res = await fetch(`/api/tenders/${tenderId}/controls`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "RISK",
            title: risk.title,
            description: risk.detail,
            priority: risk.severity,
            status: "OPEN",
            sourceReference: "Tender AI Copilot",
            impact: risk.severity,
            metadata: { source: "copilot", question },
          }),
        });
        if (!res.ok) throw new Error(`Failed to record risk: ${risk.title}`);
        count += 1;
      }
      setRecordedCount(count);
      router.refresh();
    } catch (err) {
      setError("Failed to record controls".replace("failed", "failed. Refresh to retry."));
    } finally {
      setRecording(false);
    }
  }

  const canRecord = response && (response.nextActions.length > 0 || response.risks.length > 0);

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Tender AI Copilot</h3>
          <p className="mt-0.5 text-xs text-slate-500">Ask strategic questions about this tender using requirements, gaps, selected experts/projects, documents, controls, and audit context.</p>
        </div>
        {response && <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${severityBadgeClassesCompact(severityToUISeverity(response.confidence))}`}>Confidence {response.confidence}{response.confidence === "LOW" && " (untrusted analysis)"}</span>}
      </div>

      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
      {recordedCount !== null && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">Recorded {recordedCount} Copilot action/risk item(s) into tender controls.</div>}

      <div className="mt-4 space-y-2">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={!canMutate}
          rows={3}
          placeholder="Ask: What should we fix before final submission? Which references are weakest? Is this bid ready?"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
        />
        <div className="flex flex-wrap gap-2">
          {canMutate && (
          <button type="button" disabled={loading || question.trim().length < 3} onClick={() => void ask()} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60">
            {loading ? "Thinking…" : "Ask Copilot"}
          </button>
          )}
          {canMutate && QUICK_QUESTIONS.slice(0, 3).map((q) => (
            <button key={q} type="button" disabled={loading} onClick={() => void ask(q)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-60">
              {q}
            </button>
          ))}
          {canMutate && canRecord && (
            <button type="button" disabled={recording} onClick={() => void recordControls()} className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60">
              {recording ? "Recording…" : "Record actions/risks"}
            </button>
          )}
        </div>
      </div>

      {response && (
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{response.answer}</p>
          </div>

          {response.evidenceReferences && response.evidenceReferences.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Evidence used</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">
                {response.evidenceReferences.map((ref, i) => <li key={i}>{ref}</li>)}
              </ul>
            </div>
          )}

          {response.recommendations.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Recommendations</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
                {response.recommendations.map((rec, i) => <li key={i}>{rec}</li>)}
              </ul>
            </div>
          )}

          {response.risks.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Risks</p>
              <ul className="mt-2 space-y-2">
                {response.risks.map((risk, i) => (
                  <li key={i} className="rounded-lg border border-amber-100 bg-amber-50 p-2.5 text-xs">
                    <div className="flex items-start gap-2">
                      <span className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${severityBadgeClassesCompact(severityToUISeverity(risk.severity))}`}>{risk.severity}</span>
                      <div><p className="font-medium text-amber-900">{risk.title}</p><p className="mt-0.5 text-amber-700">{risk.detail}</p></div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {response.nextActions.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Next actions</p>
              <ul className="mt-2 space-y-2">
                {response.nextActions.map((action, i) => (
                  <li key={i} className="rounded-lg border border-slate-100 bg-white p-2.5 text-xs">
                    <div className="flex flex-wrap items-start gap-2">
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${severityBadgeClassesCompact(severityToUISeverity(action.priority))}`}>{action.priority}</span>
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${OWNER_BADGE[action.owner]}`}>{action.owner}</span>
                      <div className="min-w-0 flex-1"><p className="font-medium text-slate-900">{action.title}</p><p className="mt-0.5 text-slate-600">{action.detail}</p></div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
