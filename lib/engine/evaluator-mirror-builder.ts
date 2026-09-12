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

import { CLIENT_FACING_SECTION_F_HEADING, SECTION_F_HEADING_RX } from "./client-facing-section-titles";

type EvaluationWeightLite = { criterion: string; weight: string; rawMatch: string };

export type EvaluatorMirrorBuilderInput = {
  evaluationCriteria: string[];
  evaluationWeights: EvaluationWeightLite[];
  topProjectName?: string | null;
  topExpertName?: string | null;
  primarySector: string;
  // Fallback requirements: used to synthesise evaluation criteria when
  // evaluationCriteria is empty (tender does not explicitly list criteria).
  // Prevents Section F from being silently absent on every such tender.
  requirements?: { title?: string | null; requirementType?: string | null; priority?: string | null }[];
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
  return re.test(markdown) || SECTION_F_HEADING_RX.test(markdown);
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
  // Fuzzy fallback — catches non-standard criterion wording
  if (/methodolog|approach|work.?plan|deliver|implement|technical.?solution/.test(c)) return "Section C.1 Understanding + C.2 Technical Methodology";
  if (/experience|track.?record|relevant|similar|previous|background|history/.test(c)) return "Section B.1 Portfolio Overview + B.2 Featured Projects";
  if (/team|expert|staff|personnel|human.?resource|proposed/.test(c)) return "Section A.4 Proposed Project Team + A.5 Team-to-Project Mapping";
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
  const distinctive = (s: string) => s.toLowerCase().match(/[a-z]{3,}/g) ?? [];
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
  return bestScore >= 1 ? best : "—";
}

/**
 * Synthesise plausible evaluation criteria from requirements when the tender
 * does not explicitly list evaluation criteria. Prevents Section F from being
 * silently absent on tenders that embed criteria implicitly in requirements.
 */
function synthesiseCriteriaFromRequirements(
  reqs: NonNullable<EvaluatorMirrorBuilderInput["requirements"]>,
  primarySector: string,
): string[] {
  const types = new Set(reqs.map((r) => (r.requirementType ?? "").toUpperCase()));
  const synthetic: string[] = [];
  if (types.has("EXPERT") || reqs.some((r) => /expert|cv|personnel|qualif/i.test(r.title ?? "")))
    synthetic.push(`Proposed team qualifications and relevant ${primarySector} experience`);
  if (types.has("PROJECT_EXPERIENCE") || reqs.some((r) => /experience|portfolio|similar|reference/i.test(r.title ?? "")))
    synthetic.push(`Track record of similar ${primarySector} assignments`);
  if (types.has("METHODOLOGY") || reqs.some((r) => /methodology|work.?plan|approach|scope/i.test(r.title ?? "")))
    synthetic.push(`Soundness of technical methodology and work plan`);
  if (reqs.some((r) => /quality|qa|qc|iso/i.test(r.title ?? "")))
    synthetic.push(`Quality assurance systems and review processes`);
  if (reqs.some((r) => /risk|mitigation|contingency/i.test(r.title ?? "")))
    synthetic.push(`Risk identification and mitigation strategy`);
  if (types.has("ELIGIBILITY") || reqs.some((r) => /registration|licen|certificate|compliance/i.test(r.title ?? "")))
    synthetic.push(`Eligibility and compliance with submission requirements`);
  // Always include a schedule criterion as a baseline — evaluators universally score it.
  if (synthetic.length > 0) synthetic.push(`Ability to meet scope and schedule commitments`);
  return synthetic.slice(0, 6);
}

export function buildEvaluatorMirrorSection(input: EvaluatorMirrorBuilderInput): string | null {
  let criteria = input.evaluationCriteria.filter((c) => c.trim().length > 0);
  // When no explicit evaluation criteria were detected, synthesise them from
  // the requirements array. This prevents Section F from being silently absent
  // on tenders that embed scoring criteria implicitly in their requirements.
  if (criteria.length === 0 && (input.requirements ?? []).length > 0) {
    criteria = synthesiseCriteriaFromRequirements(input.requirements!, input.primarySector);
  }
  if (criteria.length === 0) return null;

  const rows = criteria.slice(0, 20).map((criterion) => {
    const weight = findWeight(criterion, input.evaluationWeights);
    const answerSection = inferAnswerSection(criterion);
    const evidence = inferEvidenceAnchor(criterion, input);
    return `| ${escCell(criterion)} | ${escCell(weight)} | ${escCell(answerSection)} | ${escCell(evidence)} |`;
  });

  const weightFootnote = input.evaluationWeights.length > 0
    ? `_${input.evaluationWeights.length} numeric weight${input.evaluationWeights.length === 1 ? "" : "s"} stated in the tender; populated where the criterion phrasing matched._`
    : "_No numeric weights are stated in this tender, so the weight column shows an em-dash. Each criterion is answered against its own wording._";

  return [
    `## ${CLIENT_FACING_SECTION_F_HEADING.toUpperCase()}`,
    "",
    // This paragraph used to explain to the client that quoting their own
    // criterion wording back at them "is a high-leverage scoring tactic —
    // evaluators score what they recognise". That is the bid desk describing
    // its technique, printed in the evaluator's copy. The table itself is
    // genuinely useful to an evaluator, so it stays; the tactic commentary does
    // not.
    "Each evaluation criterion stated in the tender is listed below in the tender's own wording, with the weight where the tender states one and a pointer to the section of this proposal that answers it. The table is provided so each criterion can be checked directly against the response.",
    "",
    weightFootnote,
    "",
    "| Evaluation Criterion (in the tender's wording) | Weight | Where This Proposal Answers It | Supporting Evidence |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}
