/**
 * Deterministic Section G builder — Win Themes & Discriminators.
 *
 * A win theme is a defensible reason this firm wins this tender. A
 * discriminator is a specific advantage the firm holds that competitors
 * typically lack. The AI prompt (PR #228) asks Claude to produce 3–5
 * themes derived from the company evidence, paired with the discriminator
 * each theme rests on, the evaluation criterion it scores against, and
 * the evidence anchor that proves the discriminator.
 *
 * This module is the deterministic backstop. It builds Section G from:
 *
 *   - intelligence.differentiators (built by makeDifferentiators in
 *     proposal-intelligence — already client-facing claims, not AI
 *     instructions)
 *   - intelligence.evaluationCriteria — each theme is mapped to a
 *     criterion via heuristic matching
 *   - top reviewed projects + experts — for the evidence-anchor column
 *
 * Idempotent: returns null when the upstream output already contains a
 * Section G heading.
 */

type ProjectLite = { name: string; clientName?: string | null; contractValue?: number | null; currency?: string | null };
type ExpertLite = { fullName: string; title?: string | null };

export type WinThemesBuilderInput = {
  differentiators: string[];
  evaluationCriteria: string[];
  topProjects: ProjectLite[];
  topExperts: ExpertLite[];
  companyName: string;
  clientName: string;
  primarySector: string;
};

function escCell(text: string | null | undefined): string {
  if (!text) return "—";
  return text.replace(/\r?\n+/g, " ").replace(/\|/g, "/").replace(/\s{2,}/g, " ").trim() || "—";
}

function moneyShort(value?: number | null, currency?: string | null): string | null {
  if (!value || !Number.isFinite(value) || value <= 0) return null;
  const cur = currency || "ETB";
  if (value >= 1_000_000_000) return `${cur} ${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${cur} ${(value / 1_000_000).toFixed(0)}M`;
  return `${cur} ${value.toLocaleString("en-US")}`;
}

/**
 * Detect whether the upstream markdown already contains a Section G
 * Win Themes heading.
 */
export function hasWinThemesHeading(markdown: string): boolean {
  const re = /(^|\n)\s*#{1,4}\s*(?:section\s*[G:.\-\s]*)?\s*(?:win\s+themes?|themes?\s+(?:and|&)\s+discriminators?)/i;
  return re.test(markdown);
}

/**
 * Heuristic: for a given differentiator (claim about the firm), which
 * evaluation criterion is it most likely to score against? Match by
 * shared distinctive tokens.
 */
function matchCriterion(differentiator: string, criteria: string[]): string {
  if (criteria.length === 0) return "Overall technical capability";
  const distinctive = (s: string) => s.toLowerCase().match(/[a-z]{5,}/g) ?? [];
  const dTokens = new Set(distinctive(differentiator));
  let bestScore = 0;
  let best = criteria[0];
  for (const c of criteria) {
    const cTokens = distinctive(c);
    const score = cTokens.filter((t) => dTokens.has(t)).length;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/**
 * Heuristic: extract a short discriminator phrase from a (typically long)
 * differentiator claim. Strip the common "claim about firm" preamble and
 * return the substantive advantage.
 */
function extractDiscriminator(differentiator: string): string {
  let text = differentiator.trim();
  // Strip leading qualifiers
  text = text
    .replace(/^(?:Direct|In-house|Single-source|Healthcare-specific|Donor-grade|Engagement model|Each proposed|Structured|Team includes|High-value)\s+/i, "")
    .replace(/^[a-z][a-zA-Z\s\-,]+:\s*/i, "")
    .trim();
  // Truncate at first sentence-ending punctuation if too long
  const firstSentence = text.match(/^[^.;]+/)?.[0]?.trim();
  if (firstSentence && firstSentence.length >= 20 && firstSentence.length <= 160) return firstSentence;
  if (text.length > 160) return text.slice(0, 157).trim() + "…";
  return text;
}

/**
 * Build the strongest evidence anchor from top projects / experts.
 */
function buildEvidenceAnchor(themeIdx: number, input: WinThemesBuilderInput): string {
  const project = input.topProjects[themeIdx % Math.max(1, input.topProjects.length)] ?? input.topProjects[0];
  const expert = input.topExperts[themeIdx % Math.max(1, input.topExperts.length)] ?? input.topExperts[0];
  if (project && project.name) {
    const value = moneyShort(project.contractValue, project.currency);
    const client = project.clientName?.trim();
    const parts = [project.name];
    if (value) parts.push(value);
    if (client) parts.push(client);
    return parts.join(", ");
  }
  if (expert?.fullName) return `${expert.fullName}${expert.title ? `, ${expert.title}` : ""}`;
  return `${input.companyName} ${input.primarySector} portfolio evidence`;
}

/**
 * Convert a differentiator claim into a short win-theme label
 * (sentence-fragment phrase, max 8 words).
 */
function buildThemeLabel(differentiator: string): string {
  let text = differentiator.trim();
  // Strip common preambles down to the substantive label
  text = text.replace(/^(?:Direct|In-house|Single-source|Healthcare-specific|Donor-grade|Engagement model|Each proposed|Structured|Team includes|High-value)\s+/i, "");
  // Take the first noun phrase up to a colon or 60 chars
  const beforeColon = text.split(":")[0]?.trim() ?? text;
  if (beforeColon.length <= 60 && beforeColon.split(" ").length <= 9) return beforeColon;
  return beforeColon.split(" ").slice(0, 8).join(" ");
}

export function buildWinThemesSection(input: WinThemesBuilderInput): string | null {
  const claims = input.differentiators.filter((d) => d.trim().length >= 20);
  if (claims.length === 0) return null;

  const themes = claims.slice(0, 5).map((claim, idx) => ({
    label: buildThemeLabel(claim),
    discriminator: extractDiscriminator(claim),
    criterion: matchCriterion(claim, input.evaluationCriteria),
    evidence: buildEvidenceAnchor(idx, input),
  }));

  const rows = themes.map(
    (t) => `| ${escCell(t.label)} | ${escCell(t.discriminator)} | ${escCell(t.criterion)} | ${escCell(t.evidence)} |`,
  );

  const framingProject = input.topProjects[0]?.name?.trim();
  const framingExpert = input.topExperts[0]?.fullName?.trim();
  const framingValue = moneyShort(input.topProjects[0]?.contractValue, input.topProjects[0]?.currency);
  const framingFacts = [
    framingProject && framingValue ? `${framingProject} (${framingValue})` : framingProject,
    framingExpert,
  ].filter(Boolean).join(" + ");

  const framing = framingFacts
    ? `${input.companyName} positions for ${input.clientName}'s ${input.primarySector.toLowerCase()} requirement on the strength of ${framingFacts} and the firm's broader ${input.primarySector.toLowerCase()} portfolio. The themes below are not capability claims — each rests on a discriminator the firm holds and competitors typically do not, mapped to the evaluation criterion it scores against and the evidence anchor that proves the discriminator. The proposal carries the same project and expert names through the Cover Letter, Executive Summary, Section A team mapping, and Section B project portfolio so a single throughline ties theme, discriminator, evidence, and team continuity into one persuasive argument.`
    : `${input.companyName}'s positioning for this ${input.primarySector.toLowerCase()} engagement rests on the discriminators below. Each theme is anchored in firm-specific evidence and mapped to a stated evaluation criterion. The proposal carries the same evidence through every section to maintain a single throughline from theme to evaluation score.`;

  return [
    "## SECTION G: WIN THEMES & DISCRIMINATORS",
    "",
    framing,
    "",
    "| Win Theme | Discriminator (what we have, others typically don't) | Linked Evaluation Criterion | Evidence Anchor |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}
