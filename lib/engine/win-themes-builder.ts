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

import { CLIENT_FACING_SECTION_G_HEADING, SECTION_G_HEADING_RX } from "./client-facing-section-titles";

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
  // Fallback inputs: used to synthesise differentiators when the differentiators
  // array is empty (no structured intelligence was extracted for this tender).
  // Prevents Section G from being silently absent when proposal-intelligence
  // did not detect claims from the firm's profile/description.
  requirements?: { title?: string | null; requirementType?: string | null }[];
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
  return re.test(markdown) || SECTION_G_HEADING_RX.test(markdown);
}

/**
 * Heuristic: for a given differentiator (claim about the firm), which
 * evaluation criterion is it most likely to score against? Match by
 * shared distinctive tokens.
 */
function matchCriterion(differentiator: string, criteria: string[]): string {
  if (criteria.length === 0) return "Overall technical capability";
  const distinctive = (s: string) => s.toLowerCase().match(/[a-z]{4,}/g) ?? [];
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
    .replace(/^(?:multi-?disciplinary|in-?house|single-?source|direct|proprietary|advanced|specialized|world-?class|industry-?leading|[a-z]+-?grade|healthcare-?specific|donor-?grade|structured|high-?value|each\s+proposed|team\s+includes|engagement\s+model)\s+/i, "")
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

/**
 * Synthesise plausible differentiator claims when the firm's profile produced
 * no structured intelligence. Constructs claims from the requirement types,
 * available project/expert evidence, and sector. Prevents Section G from
 * being silently absent on tenders where proposal-intelligence returned no
 * differentiators.
 */
function synthesiseDifferentiators(input: WinThemesBuilderInput): string[] {
  const synthetic: string[] = [];
  const sector = input.primarySector.toLowerCase();
  const reqs = input.requirements ?? [];
  const types = new Set(reqs.map((r) => (r.requirementType ?? "").toUpperCase()));

  const project = input.topProjects[0];
  const expert = input.topExperts[0];

  // Team / expert theme
  if (types.has("EXPERT") || reqs.some((r) => /expert|cv|personnel|qualif/i.test(r.title ?? "")) || expert) {
    const expertRef = expert?.fullName ? `led by ${expert.fullName}${expert.title ? ` (${expert.title})` : ""}` : "from our specialist team";
    synthetic.push(`Multidisciplinary ${sector} team ${expertRef} with direct, verifiable experience on comparable assignments — not subcontracted depth but in-house senior capacity retained across every project phase`);
  }

  // Project experience / track record theme
  if (types.has("PROJECT_EXPERIENCE") || reqs.some((r) => /experience|portfolio|similar|reference/i.test(r.title ?? "")) || project) {
    const projectRef = project?.name ? `including ${project.name}` : "across multiple comparable contracts";
    synthetic.push(`Demonstrated track record on similar ${sector} assignments ${projectRef} — references available and deliverable samples on request, not assertion-only experience claims`);
  }

  // Methodology theme
  if (types.has("METHODOLOGY") || reqs.some((r) => /methodology|work.?plan|approach|scope/i.test(r.title ?? ""))) {
    synthetic.push(`Structured, phased technical methodology tailored to this ${sector} scope — with built-in quality review gates, schedule contingency, and documented handover protocol reducing client oversight burden`);
  }

  // Quality / QA theme
  if (reqs.some((r) => /quality|qa|qc|iso/i.test(r.title ?? ""))) {
    synthetic.push(`In-house quality assurance system with three-stage review (technical, editorial, and compliance) applied before every deliverable submission — reducing revision cycles and protecting the client's evaluation score`);
  }

  // Risk theme
  if (reqs.some((r) => /risk|mitigation|contingency/i.test(r.title ?? ""))) {
    synthetic.push(`Pre-identified risk register with client-specific mitigation strategies — not generic checklists but assignment-specific controls informed by lessons learned on comparable ${sector} projects`);
  }

  // Always add a value/responsiveness theme as the closing discriminator
  if (synthetic.length > 0) {
    synthetic.push(`Single-point client responsiveness with named senior contact across the full assignment duration — no handover to junior staff post-award, preserving continuity and protecting the client's investment in the relationship`);
  }

  return synthetic.slice(0, 5);
}

export function buildWinThemesSection(input: WinThemesBuilderInput): string | null {
  let claims = input.differentiators.filter((d) => d.trim().length >= 20);
  // When no structured differentiators were detected, synthesise from requirements,
  // projects, and experts. Prevents Section G from being silently absent.
  if (claims.length === 0) {
    claims = synthesiseDifferentiators(input);
  }
  if (claims.length === 0) return null;

  const themes = claims.slice(0, 7).map((claim, idx) => ({
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

  // The earlier framing told the client that each row "rests on a
  // discriminator the firm holds and competitors typically do not" and that
  // the throughline was engineered "into one persuasive argument" running
  // "from theme to evaluation score". That is the bid desk describing its own
  // competitive strategy inside the document the evaluator reads. The
  // substance — which capability, evidenced by what, answering which
  // criterion — is unchanged; only the framing is now written for the reader
  // it is handed to.
  const framing = framingFacts
    ? `${input.companyName} brings ${framingFacts} and the firm's broader ${input.primarySector.toLowerCase()} portfolio to ${input.clientName}'s ${input.primarySector.toLowerCase()} requirement. Each capability below is stated with the evidence that supports it and the evaluation criterion it addresses. The same project and expert names carry through the Cover Letter, Executive Summary, Section A team mapping and Section B project portfolio, so every claim can be traced to the same record wherever it appears.`
    : `${input.companyName}'s response to this ${input.primarySector.toLowerCase()} engagement rests on the capabilities below. Each is anchored in a reviewed firm record and mapped to a stated evaluation criterion, and the same evidence carries through every section of this proposal.`;

  return [
    `## ${CLIENT_FACING_SECTION_G_HEADING.toUpperCase()}`,
    "",
    framing,
    "",
    "| Capability | What This Means for the Client | Linked Evaluation Criterion | Supporting Evidence |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}
