"use client";

// Evaluator Persona Simulator panel (PR #251) — beyond-spec UI.
//
// Renders a "Simulate Panel" button + result card on the tender
// workspace. When clicked, calls /api/tenders/[id]/evaluator-simulation,
// which spawns 4 parallel Claude calls each acting as a different
// evaluator persona, then displays:
//
//   • Predicted overall score (0-100) with verdict color
//   • Per-persona assessments (collapsible)
//   • Top 6 objections (severity-ranked)
//   • Top 4 commendations
//   • Per-criterion score heatmap
//
// The simulation takes 25-50 seconds. The user opts in by clicking —
// never auto-runs (each simulation makes 4 Claude calls = ~$0.10-0.18).

import { useState } from "react";

type Persona = "TECHNICAL" | "COMPLIANCE" | "END_USER" | "COMMERCIAL";

interface PersonaAssessment {
  persona: Persona;
  personaSummary: string;
  criterionScores: Array<{ criterion: string; score: number; rationale: string }>;
  objections: Array<{ title: string; severity: "HIGH" | "MEDIUM" | "LOW"; detail: string }>;
  commendations: Array<{ title: string; detail: string }>;
  durationMs: number;
}

interface SimulationResult {
  predictedOverallScore: number;
  verdict: "STRONG_BID" | "NEEDS_WORK" | "WEAK_BID";
  personaAssessments: PersonaAssessment[];
  topObjections: Array<{ persona: Persona; title: string; severity: "HIGH" | "MEDIUM" | "LOW"; detail: string }>;
  topCommendations: Array<{ persona: Persona; title: string; detail: string }>;
  rationale: string;
  computedAt: string;
}

interface EvaluatorSimulatorPanelProps {
  tenderId: string;
}

const PERSONA_LABEL: Record<Persona, string> = {
  TECHNICAL: "Technical evaluator",
  COMPLIANCE: "Compliance evaluator",
  END_USER: "End-user evaluator",
  COMMERCIAL: "Commercial evaluator",
};

const PERSONA_ICON: Record<Persona, string> = {
  TECHNICAL: "🔬",
  COMPLIANCE: "📋",
  END_USER: "👥",
  COMMERCIAL: "💼",
};

const VERDICT_STYLE: Record<SimulationResult["verdict"], { bg: string; ring: string; text: string; label: string }> = {
  STRONG_BID: { bg: "bg-emerald-50", ring: "ring-emerald-300", text: "text-emerald-800", label: "STRONG BID" },
  NEEDS_WORK: { bg: "bg-amber-50", ring: "ring-amber-300", text: "text-amber-800", label: "NEEDS WORK" },
  WEAK_BID: { bg: "bg-red-50", ring: "ring-red-300", text: "text-red-800", label: "WEAK BID" },
};

const SEVERITY_BADGE: Record<"HIGH" | "MEDIUM" | "LOW", string> = {
  HIGH: "bg-red-100 text-red-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW: "bg-slate-100 text-slate-600",
};

function scoreColor(score: number): string {
  if (score >= 8) return "bg-emerald-500";
  if (score >= 6) return "bg-amber-500";
  if (score >= 4) return "bg-orange-500";
  return "bg-red-500";
}

export function EvaluatorSimulatorPanel({ tenderId }: EvaluatorSimulatorPanelProps) {
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPersonas, setExpandedPersonas] = useState<Set<Persona>>(new Set());

  async function runSimulation() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/evaluator-simulation`, {
        method: "POST",
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({} as { error?: string; code?: string }));
        throw new Error(errBody.error ?? `Simulation failed (${res.status})`);
      }
      const data = await res.json();
      setSimulation(data.simulation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setLoading(false);
    }
  }

  function togglePersona(persona: Persona) {
    setExpandedPersonas((prev) => {
      const next = new Set(prev);
      if (next.has(persona)) next.delete(persona);
      else next.add(persona);
      return next;
    });
  }

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">Synthetic Evaluator Panel</h3>
          <p className="mt-0.5 text-xs text-slate-500">Pre-submission red team — 4 specialist personas score the proposal as a real evaluation panel would</p>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>
      )}

      {!simulation && !loading && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs text-slate-700">
            Spawn 4 parallel Claude calls — Technical, Compliance, End-User, and Commercial evaluators — to score the proposal before real submission. Takes 25–50 seconds. Costs ~$0.10–0.18 per run.
          </p>
          <button
            type="button"
            onClick={() => void runSimulation()}
            className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800"
          >
            Simulate evaluator panel
          </button>
        </div>
      )}

      {loading && (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-center gap-3">
            <div className="h-3 w-3 animate-pulse rounded-full bg-blue-500"></div>
            <p className="text-xs text-blue-800">Running 4-persona simulation… This typically takes 25–50 seconds.</p>
          </div>
        </div>
      )}

      {simulation && (
        <div className="mt-4 space-y-4">
          {/* Headline */}
          <div className={`rounded-xl p-4 ring-2 ${VERDICT_STYLE[simulation.verdict].ring} ${VERDICT_STYLE[simulation.verdict].bg}`}>
            <div className="flex items-baseline justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Predicted overall score</p>
                <p className={`mt-1 text-4xl font-bold ${VERDICT_STYLE[simulation.verdict].text}`}>{simulation.predictedOverallScore}<span className="text-2xl">/100</span></p>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Verdict</p>
                <p className={`mt-1 text-sm font-bold ${VERDICT_STYLE[simulation.verdict].text}`}>{VERDICT_STYLE[simulation.verdict].label}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{simulation.personaAssessments.length}/4 personas reported</p>
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-700">{simulation.rationale}</p>
          </div>

          {/* Top objections */}
          {simulation.topObjections.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Top objections to address ({simulation.topObjections.length})
              </p>
              <ul className="mt-2 space-y-2">
                {simulation.topObjections.map((obj, i) => (
                  <li key={i} className="rounded-lg border border-slate-100 bg-white p-2.5 text-xs">
                    <div className="flex items-start gap-2">
                      <span className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_BADGE[obj.severity]}`}>
                        {obj.severity}
                      </span>
                      <span className="mt-0.5 shrink-0 text-base" title={PERSONA_LABEL[obj.persona]}>{PERSONA_ICON[obj.persona]}</span>
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900">{obj.title}</p>
                        <p className="mt-0.5 text-slate-600">{obj.detail}</p>
                        <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">{PERSONA_LABEL[obj.persona]}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Top commendations */}
          {simulation.topCommendations.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Strengths the panel praised
              </p>
              <ul className="mt-2 space-y-2">
                {simulation.topCommendations.map((com, i) => (
                  <li key={i} className="rounded-lg border border-emerald-100 bg-emerald-50 p-2.5 text-xs">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 text-base" title={PERSONA_LABEL[com.persona]}>{PERSONA_ICON[com.persona]}</span>
                      <div className="min-w-0">
                        <p className="font-medium text-emerald-900">{com.title}</p>
                        <p className="mt-0.5 text-emerald-700">{com.detail}</p>
                        <p className="mt-1 text-[10px] uppercase tracking-wide text-emerald-600">{PERSONA_LABEL[com.persona]}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Per-persona breakdown */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Persona breakdown</p>
            <div className="mt-2 space-y-2">
              {simulation.personaAssessments.map((a) => {
                const expanded = expandedPersonas.has(a.persona);
                const avgScore = a.criterionScores.length > 0
                  ? Math.round(a.criterionScores.reduce((s, c) => s + c.score, 0) / a.criterionScores.length * 10) / 10
                  : 0;
                return (
                  <div key={a.persona} className="rounded-lg border border-slate-100 bg-white">
                    <button
                      type="button"
                      onClick={() => togglePersona(a.persona)}
                      className="flex w-full items-center justify-between gap-3 p-3 text-left text-xs hover:bg-slate-50"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-base">{PERSONA_ICON[a.persona]}</span>
                        <span className="font-medium text-slate-900">{PERSONA_LABEL[a.persona]}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">{avgScore.toFixed(1)}/10 avg</span>
                        <span className="text-slate-400">{expanded ? "−" : "+"}</span>
                      </div>
                    </button>
                    {expanded && (
                      <div className="border-t border-slate-100 p-3 text-xs">
                        {a.personaSummary && (
                          <p className="italic text-slate-600">&ldquo;{a.personaSummary}&rdquo;</p>
                        )}
                        {a.criterionScores.length > 0 && (
                          <div className="mt-3">
                            <p className="font-semibold uppercase tracking-wide text-slate-500 text-[10px]">Criterion scores</p>
                            <ul className="mt-1.5 space-y-1.5">
                              {a.criterionScores.map((c, i) => (
                                <li key={i} className="space-y-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="truncate text-slate-700">{c.criterion}</span>
                                    <span className="shrink-0 font-medium text-slate-900">{c.score}/10</span>
                                  </div>
                                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                                    <div className={`h-full ${scoreColor(c.score)}`} style={{ width: `${c.score * 10}%` }} />
                                  </div>
                                  {c.rationale && <p className="text-[11px] text-slate-500">{c.rationale}</p>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <p className="mt-2 text-[10px] text-slate-400">Computed in {(a.durationMs / 1000).toFixed(1)}s</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-[10px] text-slate-400">Computed {new Date(simulation.computedAt).toLocaleString()}</p>
            <button
              type="button"
              onClick={() => void runSimulation()}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Re-run simulation
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
