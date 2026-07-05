/**
 * Tender Language Echo extractor.
 *
 * Pulls verbatim quoted phrases from the tender text that look like
 * evaluator language — phrases evaluators are likely to recognise and
 * reward when echoed back in the proposal narrative. Echoing the
 * evaluator's own wording is one of the highest-leverage scoring
 * tactics on competitive tenders: evaluators score what they recognise.
 *
 * The extractor returns up to 12 short, distinctive phrases. Each
 * phrase is:
 *   - drawn directly from the tender text (no paraphrasing),
 *   - between 4 and 14 words long (long enough to be specific, short
 *     enough to embed naturally in a sentence),
 *   - taken from the evaluation-criteria zone or the technical-scope
 *     zone of the tender (the two regions evaluators score against),
 *   - filtered to remove generic / boilerplate phrases that would dilute
 *     the echo signal.
 *
 * The result is consumed by the AI prompt builder (lib/engine/generate-
 * elite.ts) and injected as a structured directive: "Echo these exact
 * phrases at least once each in the proposal narrative — do not
 * paraphrase, use the evaluator's wording verbatim."
 *
 * This is pure prompt enrichment — no schema changes, no DB writes.
 */

const NOISE_PATTERNS: RegExp[] = [
  /\b(table of contents|appendix|page \d+|section \d+|annex)\b/i,
  /\b(submitted|submitted to|submitted by|signature|date)\b/i,
  /\b(this proposal|this tender|this document|the bidder|the firm)\b/i,
  /\b(must be|shall be|should be|will be|may be|is to be)\b/i,
  /\b(in accordance with|with respect to|on behalf of|as well as|as per)\b/i,
  /\b(please|thank you|best regards|sincerely)\b/i,
  /^[A-Z\s]{12,}$/, // ALL CAPS lines (headers, not evaluator language)
];

// Vocabulary signals that mark a phrase as evaluator-ish. A phrase that
// contains one of these is more likely to be in the evaluator's mental
// scoring rubric.
const EVALUATOR_SIGNAL_PATTERNS: RegExp[] = [
  /experience|qualifications|methodology|approach|capability|capacity|expertise/i,
  /quality|compliance|completeness|relevance|adequacy|sufficiency/i,
  /understanding|interpretation|grasp|knowledge|familiarity/i,
  /team|personnel|expert|staff|key personnel|multidisciplinary/i,
  /track record|proven|demonstrated|successful delivery|previous work/i,
  /risk|mitigation|contingency|safeguard|management plan/i,
  /value[- ]added|innovation|added value|beyond minimum|over and above/i,
  /work plan|schedule|timeline|deliverable|milestone|gantt/i,
  /supervis|monitoring|control|oversight|inspection|audit/i,
];

const STOPWORD_HEAVY_RE = /^\s*(the|a|an|of|in|to|with|for|by|on|at|from|and|or|that|which|this|these|those)\s/i;

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function isMostlyStopwords(value: string): boolean {
  // A phrase that starts with a stopword AND has fewer than 5 distinctive
  // (4+ letter) tokens is too weak a signal — skip it.
  const distinctive = (value.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? []).length;
  return STOPWORD_HEAVY_RE.test(value) && distinctive < 5;
}

function hasNoise(value: string): boolean {
  return NOISE_PATTERNS.some((re) => re.test(value));
}

function hasEvaluatorSignal(value: string): boolean {
  return EVALUATOR_SIGNAL_PATTERNS.some((re) => re.test(value));
}

/**
 * Locate the evaluation-criteria zone if it exists. This is the highest-
 * value region for echo extraction. If absent, returns the first 4000
 * chars of the tender text as a fallback.
 */
function evaluationZone(tenderText: string): string {
  const match = tenderText.match(/(evaluation criteria|scoring|technical evaluation|points allocation|selection criteria)[\s\S]{0,4000}/i);
  return match?.[0] ?? tenderText.slice(0, 4000);
}

/**
 * Locate the technical-scope zone (Section C / scope of services /
 * terms of reference / methodology). This is the second-highest-value
 * region.
 */
function scopeZone(tenderText: string): string {
  const match = tenderText.match(/(scope of (?:services|work)|terms of reference|technical (?:scope|methodology|approach)|section c\b)[\s\S]{0,4000}/i);
  return match?.[0] ?? "";
}

export type TenderLanguageEcho = { phrase: string; zone: "evaluation" | "scope" };

/**
 * Extract evaluator-language echoes from a tender. Returns up to maxEchoes
 * verbatim phrases, prioritising the evaluation-criteria zone over the
 * scope zone, with stricter filters and length bounds.
 *
 * Also captures criterion-label phrases — the exact names evaluators use
 * for each scoring axis (e.g. "Technical Methodology", "Relevant Experience
 * in Similar Assignments") — since echoing a criterion's exact label is the
 * highest-signal tactic available to a bidder.
 */
export function extractTenderLanguageEchoes(tenderText: string, maxEchoes = 12): TenderLanguageEcho[] {
  if (!tenderText || tenderText.length < 200) return [];

  const echoes: TenderLanguageEcho[] = [];
  const seen = new Set<string>();

  // Pass 1: extract criterion-label phrases — these appear before a score
  // and are what the evaluator literally writes on their scoresheet.
  const evalZoneText = evaluationZone(tenderText);
  const criterionLabelRe = /([A-Z][A-Za-z &/(),'\-]{8,70}?)\s*(?:[:\-—]\s*\d{1,2}\s*(?:%|points?|marks?|pts)|(?:\s+\d{1,2}\s*(?:%|points?|marks?|pts)))/g;
  for (const m of evalZoneText.matchAll(criterionLabelRe)) {
    const label = clean(m[1]).replace(/^[\d.)\-•]+\s*/, "");
    const wc = wordCount(label);
    if (wc < 2 || wc > 10) continue;
    if (hasNoise(label)) continue;
    if (label.length < 8 || label.length > 70) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    echoes.push({ phrase: label, zone: "evaluation" });
    if (echoes.length >= maxEchoes) return echoes;
  }

  const consider = (text: string, zone: "evaluation" | "scope") => {
    const fragments = text
      .replace(/\([^)]*\)/g, " ") // strip parentheticals
      .replace(/\[[^\]]*\]/g, " ") // strip brackets
      .replace(/[•▪●◦]/g, " ") // strip bullets
      .split(/[.;:!?\n\r]+/)
      .map(clean)
      .filter(Boolean);

    for (const fragment of fragments) {
      const wc = wordCount(fragment);
      if (wc < 4 || wc > 14) continue;
      if (isMostlyStopwords(fragment)) continue;
      if (hasNoise(fragment)) continue;
      if (!hasEvaluatorSignal(fragment)) continue;
      if (fragment === fragment.toUpperCase() && fragment.length > 8) continue;
      if (/^[A-Z][^.]*$/.test(fragment) && wc <= 5 && !/[a-z]/.test(fragment)) continue;
      const cleaned = fragment.replace(/^[\d.)]+\s*[-:]?\s*/, "").replace(/^[a-z][\)]\s*/i, "").trim();
      if (cleaned.length < 12) continue;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      echoes.push({ phrase: cleaned, zone });
      if (echoes.length >= maxEchoes) return;
    }
  };

  consider(evaluationZone(tenderText), "evaluation");
  if (echoes.length < maxEchoes) consider(scopeZone(tenderText), "scope");

  return echoes;
}

/**
 * Format echoes as a prompt-ready directive block. Returns an empty
 * string when there are no echoes — the caller should not include the
 * surrounding wrapper text.
 */
export function formatEchoesForPrompt(echoes: TenderLanguageEcho[]): string {
  if (echoes.length === 0) return "";
  const lines = echoes.map((e, i) => `  ${i + 1}. "${e.phrase}" (${e.zone === "evaluation" ? "evaluation criteria" : "scope"})`);
  return [
    "",
    "## TENDER LANGUAGE TO ECHO VERBATIM",
    "",
    "Below are exact phrases extracted from the tender's evaluation-criteria and scope zones. These are the words the evaluator already has in their head. Echo each phrase at least once — verbatim, in quotation marks where natural — somewhere in the proposal narrative (Cover Letter, Executive Summary, Section C Methodology, or Section F Evaluation Mirror). Do NOT paraphrase. Evaluators score what they recognise. Match their wording.",
    "",
    ...lines,
    "",
  ].join("\n");
}
