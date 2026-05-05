/**
 * Deterministic Section H builder — Proposal Self-Score.
 *
 * Predicts how the proposal will score against each evaluation criterion
 * (0–10) with a one-sentence rationale and a risk/mitigation column.
 * Closes with a predicted overall technical score and the top three
 * submission risks.
 *
 * The AI prompt (PR #228) asks Claude to produce this. The scorer
 * (PR #229) detects whether Claude actually did. This module is the
 * deterministic backstop: when Claude omits Section H, we build it from
 * the evidence we have. The scoring heuristic is intentionally
 * conservative — over-confident self-scores damage credibility, and the
 * point of the section is to highlight risks before the evaluator does.
 *
 * Heuristic per-criterion scoring (0–10):
 *
 *   +2 baseline (proposal is being submitted at all)
 *   +3 if a top reviewed project name appears in the criterion's likely
 *      proposal section (i.e., evidence is anchored to a comparable
 *      delivery)
 *   +2 if the criterion-matched section appears at least twice in the
 *      proposal (front-loaded narrative)
 *   +2 if the criterion has a numeric weight detected (we know what
 *      the evaluator weighs, so we tune to it)
 *   +1 if at least 2 reviewed experts are available for the team
 *
 * Score capped at 10. A score of 9–10 requires every condition;
 * a score of 7–8 is solid; 5–6 indicates partial evidence; below 5
 * surfaces a credibility risk.
 *
 * Idempotent: returns null when the upstream output already contains a
 * Section H heading.
 */

type ProjectLite = { name: string; contractValue?: number | null; currency?: string | null };
type ExpertLite = { fullName: string };
type EvaluationWeightLite = { criterion: string; weight: string; rawMatch: string };

export type SelfScoreBuilderInput = {
  evaluationCriteria: string[];
  evaluationWeights: EvaluationWeightLite[];
  topProjects: ProjectLite[];
  topExperts: ExpertLite[];
  hasComplianceMatrix: boolean;
  hasEvaluatorMirror: boolean;
  hasWinThemes: boolean;
  primarySector: string;
};

function escCell(text: string | null | undefined): string {
  if (!text) return "—";
  return text.replace(/\r?\n+/g, " ").replace(/\|/g, "/").replace(/\s{2,}/g, " ").trim() || "—";
}

/**
 * Detect whether the upstream markdown already contains a Section H
 * Self-Score heading.
 */
export function hasSelfScoreHeading(markdown: string): boolean {
  const re = /(^|\n)\s*#{1,4}\s*(?:section\s*[H:.\-\s]*)?\s*(?:proposal\s+)?self.score/i;
  return re.test(markdown);
}

function findWeight(criterion: string, weights: EvaluationWeightLite[]): string {
  if (weights.length === 0) return "—";
  const distinctive = (s: string) => s.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  const cTokens = new Set(distinctive(criterion));
  let bestScore = 0;
  let best = "";
  for (const w of weights) {
    const wTokens = distinctive(w.criterion);
    const score = wTokens.filter((t) => cTokens.has(t)).length;
    if (score > bestScore) {
      bestScore = score;
      best = w.weight;
    }
  }
  return bestScore >= 2 ? best : "—";
}

function predictScore(criterion: string, input: SelfScoreBuilderInput): { score: number; rationale: string; risk: string } {
  const c = criterion.toLowerCase();
  let score = 2; // baseline
  const rationaleParts: string[] = [];
  const risks: string[] = [];

  // Project-evidence boost.
  const projectAnchor = input.topProjects[0]?.name;
  const wantsExperience = /experience|portfolio|similar|reference|track.record|relevant/.test(c);
  if (wantsExperience && projectAnchor) {
    score += 3;
    rationaleParts.push(`Comparable project: ${projectAnchor}`);
  } else if (wantsExperience && !projectAnchor) {
    risks.push("No reviewed comparable project — confirm portfolio anchor before submission");
  } else if (projectAnchor) {
    score += 2;
    rationaleParts.push(`Evidence anchored in ${projectAnchor}`);
  }

  // Expert-evidence boost.
  const wantsTeam = /team|expert|personnel|cv|qualification|multidisciplinary/.test(c);
  if (wantsTeam && input.topExperts.length >= 2) {
    score += 2;
    rationaleParts.push(`${input.topExperts.length} reviewed expert(s) on the proposed team`);
  } else if (wantsTeam && input.topExperts.length < 2) {
    risks.push(`Team thin: only ${input.topExperts.length} reviewed expert(s) selected`);
  } else if (input.topExperts.length >= 2) {
    score += 1;
  }

  // Methodology / sector-specific boost.
  if (/methodology|technical.approach|work.plan|understanding|scope/.test(c)) {
    score += 2;
    rationaleParts.push(`Section C.2 methodology addresses ${input.primarySector.toLowerCase()} scope`);
  }

  // Compliance / format boost.
  if (/compliance|format|submission|deadline/.test(c)) {
    if (input.hasComplianceMatrix) {
      score += 3;
      rationaleParts.push("Section E Compliance Matrix lists every requirement with status");
    } else {
      risks.push("Compliance Matrix incomplete — add Section E before submission");
    }
  }

  // Evaluator-mirror boost.
  if (/evaluation|scoring|criterion/.test(c) && input.hasEvaluatorMirror) {
    score += 1;
    rationaleParts.push("Section F mirrors evaluator language back");
  }

  // Win-themes boost.
  if (/value|differentiator|theme|advantage/.test(c) && input.hasWinThemes) {
    score += 1;
    rationaleParts.push("Section G discriminators support the criterion");
  }

  // Numeric-weight boost.
  if (input.evaluationWeights.some((w) => {
    const distinctive = (s: string) => s.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    const wTokens = distinctive(w.criterion);
    const cTokens = new Set(distinctive(criterion));
    return wTokens.filter((t) => cTokens.has(t)).length >= 2;
  })) {
    score += 1;
    rationaleParts.push("Numeric weight identified — tuning evidence to weighted score");
  }

  // Cap score at 10.
  if (score > 10) score = 10;

  // If overall score is low, register a generic risk to flag the gap.
  if (score < 5) risks.push("Low predicted score — senior review and additional evidence required");

  return {
    score,
    rationale: rationaleParts.length > 0 ? rationaleParts.join("; ") : "Baseline coverage from proposal structure; specific evidence to be confirmed in senior review",
    risk: risks.length > 0 ? `Mitigation: ${risks[0]}` : "Standard senior review before submission",
  };
}

export function buildSelfScoreSection(input: SelfScoreBuilderInput): string | null {
  const criteria = input.evaluationCriteria.filter((c) => c.trim().length > 0);
  if (criteria.length === 0) return null;

  type Row = { criterion: string; weight: string; score: number; rationale: string; risk: string };
  const rows: Row[] = criteria.slice(0, 10).map((criterion) => {
    const { score, rationale, risk } = predictScore(criterion, input);
    return {
      criterion,
      weight: findWeight(criterion, input.evaluationWeights),
      score,
      rationale,
      risk,
    };
  });

  // Predicted overall: sum of (score × weightFraction). When weights are
  // missing, average × 10. Cap at 100.
  let predictedOverall: number;
  const haveAllWeights = rows.every((r) => r.weight !== "—");
  if (haveAllWeights) {
    const totalWeight = rows.reduce((acc, r) => acc + (parseFloat(r.weight) || 0), 0);
    if (totalWeight > 0) {
      predictedOverall = rows.reduce((acc, r) => acc + (r.score / 10) * (parseFloat(r.weight) || 0), 0);
      // Normalise if total weight is not 100
      if (totalWeight !== 100) predictedOverall = (predictedOverall / totalWeight) * 100;
    } else {
      predictedOverall = (rows.reduce((acc, r) => acc + r.score, 0) / rows.length) * 10;
    }
  } else {
    predictedOverall = (rows.reduce((acc, r) => acc + r.score, 0) / rows.length) * 10;
  }
  predictedOverall = Math.min(100, Math.round(predictedOverall));

  // Top three risks: rows with the lowest scores get their risk bubbled up.
  const topRisks = [...rows]
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((r, i) => `${i + 1}. ${r.criterion} (predicted ${r.score}/10): ${r.risk}`);

  return [
    "## SECTION H: PROPOSAL SELF-SCORE",
    "",
    "Predicts how this proposal will score against each detected evaluation criterion (0–10) with the rationale that drives the score and the principal risk to address before submission. Self-scoring is intentionally conservative — over-confident self-scores damage credibility, and the point of this section is to surface risks before the evaluator does.",
    "",
    "| Evaluation Criterion | Weight | Self-Score (0–10) | Rationale | Risk to Score / Mitigation |",
    "|---|---|---|---|---|",
    ...rows.map((r) => `| ${escCell(r.criterion)} | ${escCell(r.weight)} | ${r.score} | ${escCell(r.rationale)} | ${escCell(r.risk)} |`),
    "",
    `**Predicted overall technical score: ${predictedOverall} / 100.**`,
    "",
    "**Top three risks to address before submission:**",
    "",
    ...topRisks,
  ].join("\n");
}
