/**
 * Deterministic Section F builder — Evaluation Criteria Response Mirror.
 *
 * Mirrors each detected evaluation criterion back to the evaluator using
 * their own language, with a numeric weight (when stated) and a pointer
 * to where in the proposal the criterion is answered.
 *
 * The AI prompt (PR #228) asks Claude to produce this. The scorer
 * (PR #229) detects whether Claude actually did. This module is the
 * deterministic backstop: when Claude omits Section F, this builder
 * constructs it from the structured intelligence we already have:
 *
 *   - intelligence.evaluationCriteria (string[]) — heuristic-detected
 *     criteria from tender text
 *   - intelligence.evaluationWeights (EvaluationWeight[]) — numeric
 *     weights extracted from tender text by detectEvaluationWeights
 *
 * Each criterion is paired with a section pointer inferred from its
 * language (e.g., "healthcare experience" -> Section B.2; "team" -> A.4).
 *
 * Idempotent: returns null when the upstream output already contains a
 * Section F heading.
 */

type EvaluationWeightLite = { criterion: string; weight: string; rawMatch: string };

export type EvaluatorMirrorBuilderInput = {
  evaluationCriteria: string[];
  evaluationWeights: EvaluationWeightLite[];
  topProjectName?: string | null;
  topExpertName?: string | null;
  primarySector: string;
};

function escCell(text: string | null | undefined): string {
  if (!text) return "—";
  return text.replace(/\r?\n+/g, " ").replace(/\|/g, "/").replace(/\s{2,}/g, " ").trim() || "—";
}

/**
 * Detect whether the upstream markdown already contains a Section F
 * Evaluation Criteria Response Mirror.
 */
export function hasEvaluatorMirrorHeading(markdown: string): boolean {
  const re = /(^|\n)\s*#{1,4}\s*(?:section\s*[F:.\-\s]*)?\s*(?:evaluation\s+criteria\s+response\s+mirror|evaluation\s+(?:criteria\s+)?response|evaluator(?:'s)?\s+mirror|evaluation\s+mirror)/i;
  return re.test(markdown);
}

/**
 * Heuristic: pick the proposal section likely to answer a given criterion.
 * Mirrors the language families used by inferProposalLocation in
 * compliance-matrix-builder, but tuned for evaluator-criterion phrasing
 * (which is more abstract than requirement phrasing).
 */
function inferAnswerSection(criterion: string): string {
  const c = criterion.toLowerCase();
  if (/team|expert|personnel|cv|qualification|multidisciplinary/.test(c)) return "Section A.4 Proposed Project Team + A.5 Team-to-Project Mapping";
  if (/experience|portfolio|similar|reference|track.record/.test(c)) return "Section B.1 Client References + B.2 Project Portfolio";
  if (/methodology|technical.approach|work.plan|understanding|scope/.test(c)) return "Section C.1 Understanding + C.2 Technical Methodology";
  if (/quality|qa|qc|review|audit|iso/.test(c)) return "Section C.3 Quality Assurance + Three-Stage Review";
  if (/risk|mitigation|contingency/.test(c)) return "Section C.5 Risk Register and Mitigation Strategy";
  if (/schedule|timeline|deliverable|milestone|gantt|work.plan/.test(c)) return "Section C.6 Work Plan and Schedule";
  if (/value.added|innovation|additional.service|added.value/.test(c)) return "Section D.1 Value to the Client + D.2 Value-Added Services";
  if (/company.profile|organisational|capacity|registration|certification/.test(c)) return "Section A.1 Company Background + A.2 Corporate Information";
  if (/financial|turnover|audited|capacity/.test(c)) return "Section A.1 Company Background + Appendix E";
  if (/donor|safeguard|world.bank|undp|esf|ifc/.test(c)) return "Section C.2 Methodology + D.3 Certifications + Compliance Matrix";
  if (/compliance|format|submission|deadline/.test(c)) return "Section E Compliance Matrix + cover letter submission confirmation";
  return "Section A–D (cross-referenced in Compliance Matrix)";
}

/**
 * Derive the strongest evidence anchor for a criterion. Uses the top
 * project / expert names when available, falling back to a generic
 * sector reference.
 */
function inferEvidenceAnchor(criterion: string, input: EvaluatorMirrorBuilderInput): string {
  const c = criterion.toLowerCase();
  const project = input.topProjectName?.trim();
  const expert = input.topExpertName?.trim();
  if (/team|expert|personnel|cv/.test(c) && expert) return `Lead expert ${expert} on a comparable previous project (see Section A.5)`;
  if ((/experience|portfolio|similar|reference|track.record/.test(c)) && project) return `Featured project: ${project} (see Section B.2)`;
  if (project) return `Featured project: ${project}`;
  if (expert) return `Proposed lead expert: ${expert}`;
  return `${input.primarySector} portfolio evidence (see Section B.2)`;
}

/**
 * Match a criterion phrase to its detected numeric weight. Matching is
 * loose: we accept any criterion that shares 2+ distinctive tokens with
 * the weight's criterion field. This handles minor phrasing differences
 * between detectEvaluationCriteria and detectEvaluationWeights.
 */
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

export function buildEvaluatorMirrorSection(input: EvaluatorMirrorBuilderInput): string | null {
  const criteria = input.evaluationCriteria.filter((c) => c.trim().length > 0);
  if (criteria.length === 0) return null;

  const rows = criteria.slice(0, 12).map((criterion) => {
    const weight = findWeight(criterion, input.evaluationWeights);
    const answerSection = inferAnswerSection(criterion);
    const evidence = inferEvidenceAnchor(criterion, input);
    return `| ${escCell(criterion)} | ${escCell(weight)} | ${escCell(answerSection)} | ${escCell(evidence)} |`;
  });

  const weightFootnote = input.evaluationWeights.length > 0
    ? `_${input.evaluationWeights.length} numeric weight${input.evaluationWeights.length === 1 ? "" : "s"} detected in tender; populated where the criterion phrasing matched._`
    : "_No numeric weights stated in this tender — weight column shows em-dash. Mirror table still scores against the criterion language itself._";

  return [
    "## SECTION F: EVALUATION CRITERIA RESPONSE MIRROR",
    "",
    "Every detected evaluation criterion is mirrored back to the evaluator using their own language, with the numeric weight (when stated in the tender) and a pointer to the proposal section that answers the criterion. Mirroring criterion language back at the evaluator using their exact wording is a high-leverage scoring tactic — evaluators score what they recognise.",
    "",
    weightFootnote,
    "",
    "| Evaluation Criterion (echoed in tender language) | Weight | Where This Proposal Answers It | Strongest Evidence Anchor |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}
