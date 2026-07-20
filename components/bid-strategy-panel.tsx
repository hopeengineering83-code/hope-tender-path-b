"use client";

// Bid Strategy panel (PR #249) — beyond-spec feature.
//
// Renders the deterministic Bid/No-Bid Decision Engine output as a
// visual strategy card on the tender workspace. The card surfaces
// the win-probability score, the recommendation (BID_HARD /
// BID_CAREFULLY / DECLINE), the bid posture (SOLO / JV / SUBCONTRACT),
// the top 3 risks, the top 3 advantages, and a per-dimension score
// breakdown.
//
// Drop into the tender workspace as a sticky right-rail card so the
// bid team sees the verdict before clicking Generate Docs. Saves
// 40+ person-hours per misjudged bid by surfacing structural issues
// up-front.

import { useState, useEffect, useCallback } from "react";

type BidStrategy = {
  winProbability: number;
  recommendation: "BID_HARD" | "BID_CAREFULLY" | "DECLINE";
  bidPosture: "SOLO" | "JV_RECOMMENDED" | "SUBCONTRACT_REQUIRED" | "DECLINE";
  rationale: string;
  topRisks: Array<{ title: string; severity: "HIGH" | "MEDIUM" | "LOW"; mitigation: string; category?: "COMPLIANCE" | "CAPABILITY" | "PORTFOLIO" | "ELIGIBILITY" }>;
  topAdvantages: Array<{ title: string; evidenceAnchor: string }>;
  dimensionScores: {
    capabilityCoverage: number;
    experienceFit: number;
    complianceReadiness: number;
    evaluationAlignment: number;
    eligibilityClearance: number;
  };
  /** Gap classifier output (J) — distinguishes system-readiness gaps from
   *  true company-capability gaps so a low capability score doesn't get
   *  read as "the company can't do this work". */
  gapAnalysis?: {
    capabilityGapCause:
      | "NO_CAPABILITY_GAP"
      | "TRUE_CAPABILITY_GAP"
      | "EVIDENCE_LINKING_GAP"
      | "METADATA_EXTRACTION_GAP"
      | "PROVIDER_RATE_LIMIT_GAP";
    systemReadinessGapsPresent: boolean;
    signals: {
      analysisRegexFallback: boolean;
      noRequirementsExtracted: boolean;
      vaultLacksReviewedExperts: boolean;
      vaultHasExpertsButNoneLinked: boolean;
      vaultHasExpertsButNoneReviewed: boolean;
      evidenceCoverageZero: boolean;
    };
    explanation: string;
    inhibitDecline: boolean;
  };
  computedAt: string;
};

type WinProbabilityBreakdown = {
  score: number;
  label: "Strong" | "Competitive" | "Fair" | "Weak";
  breakdown: {
    evidenceMatch: number;
    teamStrength: number;
    compliancePosture: number;
    historicalOutcomes: number;
  };
  notes: string[];
};

type HistoricalBidStats = { total: number; wins: number };

interface BidStrategyPanelProps {
  tenderId: string;
  // Optional: collapsed by default to keep the workspace scannable.
  defaultExpanded?: boolean;
}

const RECOMMENDATION_STYLE: Record<BidStrategy["recommendation"], { bg: string; ring: string; text: string; label: string }> = {
  BID_HARD: { bg: "bg-emerald-50", ring: "ring-emerald-300", text: "text-emerald-800", label: "BID HARD" },
  BID_CAREFULLY: { bg: "bg-amber-50", ring: "ring-amber-300", text: "text-amber-800", label: "BID CAREFULLY" },
  DECLINE: { bg: "bg-red-50", ring: "ring-red-300", text: "text-red-800", label: "DECLINE" },
};

const POSTURE_LABEL: Record<BidStrategy["bidPosture"], string> = {
  SOLO: "Solo bid",
  JV_RECOMMENDED: "JV recommended",
  SUBCONTRACT_REQUIRED: "Subcontract required",
  DECLINE: "Decline",
};

const SEVERITY_BADGE: Record<"HIGH" | "MEDIUM" | "LOW", string> = {
  HIGH: "bg-red-100 text-red-700",
  MEDIUM: "bg-amber-100 text-amber-800",
  LOW: "bg-slate-100 text-slate-600",
};

const DIMENSION_LABEL: Record<keyof BidStrategy["dimensionScores"], string> = {
  capabilityCoverage: "Capability coverage",
  experienceFit: "Experience fit",
  complianceReadiness: "Compliance readiness",
  evaluationAlignment: "Evaluation alignment",
  eligibilityClearance: "Eligibility clearance",
};

function dimensionBarColor(score: number): string {
  if (score >= 70) return "bg-emerald-500";
  if (score >= 45) return "bg-amber-500";
  return "bg-red-500";
}

// API may return a blocked response when extraction quality is too low.
type BlockedStrategyResponse = {
  strategy: null;
  blocked: true;
  reason: string;
  message: string;
};

export function BidStrategyPanel({ tenderId, defaultExpanded = true }: BidStrategyPanelProps) {
  const [strategy, setStrategy] = useState<BidStrategy | null>(null);
  const [blocked, setBlocked] = useState<BlockedStrategyResponse | null>(null);
  const [winBreakdown, setWinBreakdown] = useState<WinProbabilityBreakdown | null>(null);
  const [historicalStats, setHistoricalStats] = useState<HistoricalBidStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [confidenceNote, setConfidenceNote] = useState<string | null>(null);
  const [unavailableBlockers, setUnavailableBlockers] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setBlocked(null);
    setUnavailableBlockers([]);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/bid-strategy`);
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({} as { error?: string; blockers?: string[] }));
        if (Array.isArray(errBody.blockers)) setUnavailableBlockers(errBody.blockers);
        throw new Error(errBody.error ?? `Strategy fetch failed (${res.status})`);
      }
      const data = await res.json();
      // Handle the blocked response added in PR 3 — extraction is unreliable.
      if (data.blocked === true) {
        setBlocked(data as BlockedStrategyResponse);
        return;
      }
      setStrategy(data.strategy);
      if (data.winProbabilityBreakdown) setWinBreakdown(data.winProbabilityBreakdown);
      if (data.historicalBidStats) setHistoricalStats(data.historicalBidStats);
      setConfidenceNote(data.confidenceCapped ? (data.confidenceNote ?? null) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load bid strategy");
    } finally {
      setLoading(false);
    }
  }, [tenderId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Bid Strategy</h3>
        <p className="mt-1.5 text-xs text-slate-400">Computing win probability…</p>
      </div>
    );
  }

  // Blocked state — API explicitly flagged extraction as too unreliable for strategy.
  if (blocked) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="font-semibold text-amber-800">Bid Strategy Unavailable</p>
        <p className="text-sm text-amber-800 mt-1">
          {blocked.message || "Bid strategy requires reliable extraction and analysis. Run OCR or re-run AI Analyze first."}
        </p>
        <button onClick={() => void load()} className="mt-3 rounded border border-amber-300 bg-white px-2.5 py-1 text-xs text-amber-800 hover:bg-amber-100">
          Retry
        </button>
      </div>
    );
  }

  if (error || !strategy) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
        <h3 className="text-sm font-semibold text-red-900">Bid Strategy unavailable</h3>
        <p className="mt-1.5 text-xs text-red-700">{error ?? "Strategy could not be computed"}</p>
        {unavailableBlockers.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-red-700">
            {unavailableBlockers.slice(0, 5).map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        )}
        <button onClick={() => void load()} className="mt-2 rounded border border-red-300 bg-white px-2.5 py-1 text-xs text-red-700 hover:bg-red-100">
          Retry
        </button>
      </div>
    );
  }

  const recStyle = RECOMMENDATION_STYLE[strategy.recommendation];

  return (
    <div className={`rounded-2xl border bg-white p-5 shadow-sm ring-2 ${recStyle.ring}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">Bid Strategy</h3>
          <p className="mt-0.5 text-xs text-slate-500">Pre-generation win-probability assessment</p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="rounded text-xs text-slate-500 hover:text-slate-900"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>

      {confidenceNote && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-800">
          <span className="font-semibold">Confidence capped: </span>{confidenceNote}
        </div>
      )}

      {/* Headline: win probability + recommendation */}
      <div className={`mt-4 rounded-xl p-4 ${recStyle.bg}`}>
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Win probability</p>
            <p className={`mt-1 text-4xl font-bold ${recStyle.text}`}>{strategy.winProbability}<span className="text-2xl">%</span></p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Recommendation</p>
            <p className={`mt-1 text-sm font-bold ${recStyle.text}`}>{recStyle.label}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">{POSTURE_LABEL[strategy.bidPosture]}</p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-700">{strategy.rationale}</p>
        {strategy.gapAnalysis && strategy.gapAnalysis.capabilityGapCause !== "NO_CAPABILITY_GAP" && (
          <div className={`mt-3 rounded-lg border p-2.5 text-xs ${strategy.gapAnalysis.inhibitDecline ? "border-amber-200 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-900"}`}>
            <p className="font-semibold">
              Capability score read with care — gap cause: {strategy.gapAnalysis.capabilityGapCause.replace(/_/g, " ").toLowerCase()}
            </p>
            <p className="mt-1 leading-relaxed">{strategy.gapAnalysis.explanation}</p>
            {strategy.gapAnalysis.inhibitDecline && (
              <p className="mt-1 font-medium">Recommendation was prevented from collapsing to DECLINE because the gap is system-readiness, not true capability — repair the gap and re-run before deciding.</p>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <>
          {/* Dimension breakdown */}
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Dimension scores</p>
            <div className="mt-2 space-y-1.5">
              {Object.entries(strategy.dimensionScores).map(([key, value]) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-40 shrink-0 text-xs text-slate-700">{DIMENSION_LABEL[key as keyof BidStrategy["dimensionScores"]]}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full transition-all ${dimensionBarColor(value)}`}
                      style={{ width: `${value}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right text-xs font-medium text-slate-700">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top risks */}
          {strategy.topRisks.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Top risks to address</p>
              <ul className="mt-2 space-y-2">
                {strategy.topRisks.map((risk, i) => (
                  <li key={i} className="rounded-lg border border-slate-100 bg-white p-2.5 text-xs">
                    <div className="flex items-start gap-2">
                      <span className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_BADGE[risk.severity]}`}>
                        {risk.severity}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-medium text-slate-900">{risk.title}</p>
                          {risk.category && (
                            <span className="rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide bg-slate-100 text-slate-500">
                              {risk.category}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-slate-600">{risk.mitigation}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Top advantages */}
          {strategy.topAdvantages.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Top advantages to amplify</p>
              <ul className="mt-2 space-y-2">
                {strategy.topAdvantages.map((adv, i) => (
                  <li key={i} className="rounded-lg border border-emerald-100 bg-emerald-50 p-2.5 text-xs">
                    <p className="font-medium text-emerald-900">{adv.title}</p>
                    <p className="mt-0.5 text-emerald-700">{adv.evidenceAnchor}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Win probability 4-axis breakdown */}
          {winBreakdown && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Win probability breakdown
                <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                  winBreakdown.label === "Strong" ? "bg-emerald-100 text-emerald-800" :
                  winBreakdown.label === "Competitive" ? "bg-blue-100 text-blue-800" :
                  winBreakdown.label === "Fair" ? "bg-amber-100 text-amber-800" :
                  "bg-red-100 text-red-800"
                }`}>{winBreakdown.label}</span>
              </p>
              <div className="mt-2 space-y-1.5">
                {([
                  { key: "evidenceMatch", label: "Evidence match", max: 30 },
                  { key: "teamStrength", label: "Team strength", max: 25 },
                  { key: "compliancePosture", label: "Compliance posture", max: 25 },
                  { key: "historicalOutcomes", label: "Historical outcomes", max: 20 },
                ] as const).map(({ key, label, max }) => {
                  const val = winBreakdown.breakdown[key];
                  const pct = Math.round((val / max) * 100);
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <span className="w-36 shrink-0 text-xs text-slate-700">{label}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className={`h-full transition-all ${dimensionBarColor(pct)}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-12 shrink-0 text-right text-xs font-medium text-slate-700">{val}/{max}</span>
                    </div>
                  );
                })}
              </div>
              {winBreakdown.notes.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {winBreakdown.notes.map((note, i) => (
                    <li key={i} className="text-[11px] text-slate-500">• {note}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Historical bid stats */}
          {historicalStats && historicalStats.total > 0 && (
            <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Historical record: <strong>{historicalStats.wins}/{historicalStats.total}</strong> bids won
              ({Math.round((historicalStats.wins / historicalStats.total) * 100)}% win rate) — factored into win probability.
            </div>
          )}

          <p className="mt-3 text-[10px] text-slate-400">Computed {new Date(strategy.computedAt).toLocaleString()}</p>
        </>
      )}
    </div>
  );
}
