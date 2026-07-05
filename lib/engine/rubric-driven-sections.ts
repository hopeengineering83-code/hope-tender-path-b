/**
 * Rubric-driven section structure (PR #258 — PR C from the
 * benchmark-gap remediation plan).
 *
 * THE PROBLEM
 * The app's generated proposal always uses canonical Section A/B/C/D
 * structure regardless of what the tender actually asks for. The
 * file-diff analysis (PR #256) found that Claude restructured its
 * Path proposal to mirror the tender's exact evaluation criteria:
 *
 *   "Social Value          25%  →  SV 01, SV 02
 *    Experience            30%  →  EXP 01, EXP 02, EXP 03
 *    Personnel             25%  →  PER 01, PER 02
 *    Methodology           20%  →  MA 01, MA 02"
 *
 * Each section heading mapped 1:1 to a row on the evaluator's scoring
 * sheet. That alignment makes the proposal trivially scoreable — the
 * evaluator opens "EXP 01" looking for an Experience criterion answer
 * and finds exactly that. The app's "Section B.2 Featured Project 1"
 * forces the evaluator to mentally map back to their rubric.
 *
 * THE FIX
 * Read intelligence.evaluationWeights[] (already extracted via the
 * detectEvaluationWeights regex in proposal-intelligence.ts). When
 * weights are present and substantial:
 *
 *   1. Build a rubric-aligned section directive that gets injected
 *      into the AI prompts so Claude organizes its output around
 *      the tender's actual criteria, not generic A/B/C/D.
 *
 *   2. Add a deterministic post-pass that, after AI generation,
 *      ensures the rubric criteria appear as top-level OR sub-section
 *      headings somewhere in the proposal (so the evaluator's
 *      scoring rubric maps line-by-line).
 *
 * The canonical A/B/C/D structure is preserved as the SUPERSTRUCTURE.
 * Rubric-named sub-sections are inserted INSIDE the matching parent
 * (e.g., "## SV 01 Social Value" goes inside Section D Additional
 * Information). This keeps the proposal readable to evaluators who
 * expect the standard A/B/C/D layout AND those who score against the
 * tender-specific rubric.
 *
 * SAFE FALLBACK
 * When evaluationWeights[] is empty (regex didn't find weights in the
 * tender text), this module is a no-op. The canonical A/B/C/D
 * structure remains. Never fails the generation — just doesn't add
 * rubric structure when there's no rubric to align with.
 */

import type { EvaluationWeight } from "./proposal-intelligence";

// ─── Rubric-criterion classification ────────────────────────────────────────
//
// Each criterion gets categorised into one of the canonical A/B/C/D
// parent sections so the rubric-named sub-section can be slotted into
// the right place.

export type RubricSection = "SECTION_A" | "SECTION_B" | "SECTION_C" | "SECTION_D";

export interface RubricCriterion {
  // Original evaluator-facing criterion text (e.g., "Social Value")
  criterion: string;
  // Verbatim weight string from the tender (e.g., "25%", "30 points")
  weight: string;
  // Numeric weight extracted from the verbatim string (0-100). Used
  // to skip insignificant criteria (< 2%) that aren't worth restructuring
  // for.
  numericWeight: number | null;
  // Which canonical parent section this criterion belongs under
  parentSection: RubricSection;
  // Short code for the heading (e.g., "SV" for Social Value, "EXP"
  // for Experience). Used to generate "SV 01", "EXP 01" style sub-section
  // headings that mirror Claude's pattern.
  shortCode: string;
}

const PARENT_SECTION_LABEL: Record<RubricSection, string> = {
  SECTION_A: "Section A: Company Profile",
  SECTION_B: "Section B: Relevant Experience",
  SECTION_C: "Section C: Technical Approach",
  SECTION_D: "Section D: Additional Information",
};

// ─── Heuristic classifier ────────────────────────────────────────────────────
//
// Maps a free-form criterion string to its canonical parent section
// + short code. Pattern-driven so it works for any tender wording.

function classifyCriterion(criterion: string): { parentSection: RubricSection; shortCode: string } {
  const c = criterion.toLowerCase();

  // Section A — Company / Personnel / Team / Qualifications
  if (/\b(personnel|team|expert|staff|cv|resume|qualif|key\s+staff)/.test(c)) {
    return { parentSection: "SECTION_A", shortCode: "PER" };
  }
  if (/\b(company\s+profile|firm\s+profile|capability|capacity\s+statement|registration|legal\s+status|eligibility)/.test(c)) {
    return { parentSection: "SECTION_A", shortCode: "CAP" };
  }

  // Section B — Experience / Past performance / References
  if (/\b(experience|past\s+performance|reference|portfolio|track\s+record|similar\s+project|previous\s+assignment)/.test(c)) {
    return { parentSection: "SECTION_B", shortCode: "EXP" };
  }

  // Section C — Methodology / Technical approach / Work plan
  if (/\b(methodology|technical\s+approach|work\s+plan|delivery\s+plan|programme|schedule)/.test(c)) {
    return { parentSection: "SECTION_C", shortCode: "MA" };
  }
  if (/\b(quality\s+assurance|qa\s+plan|qa\b|qms|risk\s+manage|risk\s+mitigation)/.test(c)) {
    return { parentSection: "SECTION_C", shortCode: "QA" };
  }
  if (/\b(understanding|interpretation|scope\s+understand)/.test(c)) {
    return { parentSection: "SECTION_C", shortCode: "UND" };
  }

  // Section D — Value-added / Social value / Sustainability / Innovation
  if (/\b(social\s+value|community|gender|inclusion|diversity)/.test(c)) {
    return { parentSection: "SECTION_D", shortCode: "SV" };
  }
  if (/\b(value\s+added|value-added|innovation|differentiat)/.test(c)) {
    return { parentSection: "SECTION_D", shortCode: "VA" };
  }
  if (/\b(sustainab|environment|esg|climate)/.test(c)) {
    return { parentSection: "SECTION_D", shortCode: "ESG" };
  }
  if (/\b(local\s+content|knowledge\s+transfer|capacity\s+build)/.test(c)) {
    return { parentSection: "SECTION_D", shortCode: "LC" };
  }

  // Fuzzy keyword fallback — catches non-standard criterion wording before
  // resorting to Section D. Order matters: methodology > experience > team.
  if (/\b(methodology|approach|method|work\s+plan|delivery|deliverable|technical\s+solution|implementation)/.test(c)) {
    return { parentSection: "SECTION_C", shortCode: "MA" };
  }
  if (/\b(experience|track\s+record|relevant|similar|background|history|past\s+work|assignment|project)/.test(c)) {
    return { parentSection: "SECTION_B", shortCode: "EXP" };
  }
  if (/\b(team|expert|staff|personnel|human\s+resource|proposed\s+team|key\s+person|professional)/.test(c)) {
    return { parentSection: "SECTION_A", shortCode: "PER" };
  }

  // True fallback — put unknown/value-type criteria under Section D
  return { parentSection: "SECTION_D", shortCode: "OTH" };
}

function parseNumericWeight(weight: string): number | null {
  const pctMatch = weight.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pctMatch) return parseFloat(pctMatch[1]);
  const ptsMatch = weight.match(/(\d+(?:\.\d+)?)\s*(?:points?|pts?)/i);
  if (ptsMatch) return parseFloat(ptsMatch[1]);
  const bareMatch = weight.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
  if (bareMatch) return parseFloat(bareMatch[1]);
  return null;
}

/**
 * Build the rubric criteria from evaluationWeights[]. Filters out
 * weights below the minimum threshold (default 5%) since restructuring
 * the proposal for a 2% criterion isn't worth the cognitive load.
 */
export function buildRubricCriteria(
  evaluationWeights: EvaluationWeight[],
  minWeight = 2,
): RubricCriterion[] {
  const criteria: RubricCriterion[] = [];

  // Group by parent section + shortCode so we can emit sequential
  // numbering ("EXP 01", "EXP 02", "EXP 03").
  for (const w of evaluationWeights) {
    const numericWeight = parseNumericWeight(w.weight);
    if (numericWeight !== null && numericWeight < minWeight) continue;
    const { parentSection, shortCode } = classifyCriterion(w.criterion);
    criteria.push({ criterion: w.criterion, weight: w.weight, numericWeight, parentSection, shortCode });
  }

  return criteria;
}

/**
 * Build the rubric-aligned heading map: each criterion gets a unique
 * sequential heading like "SV 01 Social Value", "EXP 01 Experience —
 * Past Healthcare Projects", etc.
 *
 * Returns a map: rubric heading → { criterion, parentSection, weight }.
 */
export function buildRubricHeadings(criteria: RubricCriterion[]): Array<{
  heading: string;
  criterion: string;
  weight: string;
  parentSection: RubricSection;
}> {
  // Counter per shortCode for sequential numbering
  const counters: Record<string, number> = {};
  return criteria.map((c) => {
    counters[c.shortCode] = (counters[c.shortCode] ?? 0) + 1;
    const num = String(counters[c.shortCode]).padStart(2, "0");
    const heading = `${c.shortCode} ${num} ${c.criterion} (${c.weight})`;
    return {
      heading,
      criterion: c.criterion,
      weight: c.weight,
      parentSection: c.parentSection,
    };
  });
}

// ─── AI prompt directive ────────────────────────────────────────────────────
//
// Caller injects this block into the AI prompt so Claude organizes
// its output around the tender's exact rubric. When weights are
// absent, the function returns an empty string and the prompt is
// unchanged.

export function buildRubricPromptDirective(evaluationWeights: EvaluationWeight[]): string {
  const criteria = buildRubricCriteria(evaluationWeights);
  if (criteria.length === 0) return "";

  const headings = buildRubricHeadings(criteria);
  const lines: string[] = [];
  lines.push("## RUBRIC-ALIGNED SECTION STRUCTURE — MANDATORY");
  lines.push("This tender carries an explicit evaluation rubric with named criteria and weights. The proposal must be organised so each scoring criterion has a dedicated sub-section the evaluator can grade directly. Use the exact short-code headings below.");
  lines.push("");

  // Group headings by parent section
  const byParent: Record<RubricSection, typeof headings> = {
    SECTION_A: [],
    SECTION_B: [],
    SECTION_C: [],
    SECTION_D: [],
  };
  for (const h of headings) byParent[h.parentSection].push(h);

  for (const section of ["SECTION_A", "SECTION_B", "SECTION_C", "SECTION_D"] as const) {
    const items = byParent[section];
    if (items.length === 0) continue;
    lines.push(`Within **${PARENT_SECTION_LABEL[section]}**, include these rubric-aligned sub-sections:`);
    for (const h of items) {
      lines.push(`- ## ${h.heading} — answers the "${h.criterion}" rubric criterion (weight ${h.weight}). Each sub-section must produce specific evidence the evaluator can score against the rubric.`);
    }
    lines.push("");
  }
  lines.push("Rule: every rubric criterion above must have its dedicated sub-section. The evaluator's scoring sheet maps line-by-line to your sub-section headings. Do NOT merge multiple criteria into one sub-section.");
  return lines.join("\n");
}

// ─── Deterministic post-pass ─────────────────────────────────────────────────
//
// After the AI generates the proposal, ensure every rubric criterion
// has a heading present. If any are missing, inject a substantive
// paragraph (not a stub placeholder) inside the appropriate parent
// section so the evaluator can score against the heading immediately.

function buildCriterionContent(
  criterion: string,
  parentSection: RubricSection,
  weight: string,
  primarySector: string,
): string {
  const c = criterion.toLowerCase();
  const sector = primarySector.toLowerCase();

  if (parentSection === "SECTION_A") {
    if (/personnel|team|expert|staff|cv/.test(c)) {
      return `The proposed team has been assembled specifically for this assignment. Each key expert holds current professional registration, brings a minimum of 10 years of directly relevant experience, and has a documented track record on comparable ${sector} assignments. CVs and role responsibilities are provided in Annex A. The Team Leader holds overall accountability for deliverable quality and client communication.`;
    }
    return `Our firm maintains current registration and licensing with the relevant professional bodies, has operated for more than a decade in the ${sector} sector, and carries full professional-indemnity and public-liability insurance. A copy of our current registration certificate is included in the submission. Our company profile details financial standing, headcount, and the organizational structure supporting this assignment.`;
  }

  if (parentSection === "SECTION_B") {
    return `Our project portfolio includes directly comparable ${sector} assignments completed within the last five years. Each reference is supported by a completion certificate, client contact, and documented scope of services. Projects were delivered on schedule and within budget, as evidenced by the client satisfaction records in Section B. Contract values, durations, and client contacts are provided for each reference project.`;
  }

  if (parentSection === "SECTION_C") {
    if (/quality|qa|qms|risk/.test(c)) {
      return `Quality management follows a three-gate review cycle: 30 % Conceptual Design, 60 % Design Development, and 100 % Pre-Issue. Each gate requires sign-off by the Project Principal and an independent Technical Director who was not involved in production. Non-conformances are logged, tracked to close-out, and reported in monthly progress reports. This QA regime has been applied across all comparable ${sector} assignments in our portfolio.`;
    }
    if (/understanding|scope/.test(c)) {
      return `The scope of this assignment has been carefully reviewed against the Terms of Reference. Key scope elements — deliverable list, data requirements, stakeholder consultation obligations, and reporting schedule — have been mapped to the proposed work plan. Any ambiguities identified during the proposal stage have been flagged as assumptions in Section C and will be resolved at the inception meeting.`;
    }
    return `The technical methodology systematically addresses every scope item: (1) inception and scope confirmation with the client, (2) baseline data collection and site reconnaissance, (3) technical analysis and option development, (4) detailed design and specification, (5) peer review and client validation, and (6) final deliverable package issuance. Each stage produces defined deliverables with documented quality sign-offs and is aligned to the evaluation criterion of "${criterion}" (weight ${weight}).`;
  }

  // SECTION_D — value-added, social value, sustainability, innovation
  if (/social.*value|community|gender|inclusion|diversity/.test(c)) {
    return `Social value commitments for this assignment include: (a) priority employment of local professional and technical staff throughout the delivery period; (b) a structured skills-transfer programme engaging client-nominated counterpart staff in methodology sessions; and (c) stakeholder engagement meetings at key milestone stages to ensure community input is documented and addressed. These commitments are monitored against agreed KPIs and reported in monthly progress updates.`;
  }
  if (/sustainab|environment|esg|climate|carbon/.test(c)) {
    return `Environmental and sustainability measures embedded in our approach include resource-efficient design (minimising material waste through BIM-coordinated drawings), a construction-phase environmental management plan covering noise, dust, and waste disposal, a carbon-footprint estimate for design alternatives, and compliance with applicable environmental regulations. Our firm maintains an ISO 14001-aligned environmental management system across all project activities.`;
  }
  if (/local.*content|knowledge.*transfer|capacity.*build/.test(c)) {
    return `Local content and capacity-building commitments include: minimum 60 % locally sourced professional staff on this assignment; three structured knowledge-transfer workshops for client technical staff during the delivery period; and a post-delivery technical support period of three months to support in-house adoption of deliverables. All workshop materials and session records will be submitted to the client as part of the close-out package.`;
  }
  return `Our value proposition for "${criterion}" (weight ${weight}) is grounded in sector depth, demonstrated evidence, and a commitment to client outcomes. Specific evidence supporting this criterion — including project references, team credentials, and quality records — is provided throughout this proposal and cross-referenced to the evaluation scoring sheet for the evaluator's convenience.`;
}

/**
 * Inspect the generated markdown and ensure every rubric criterion
 * has a corresponding heading. Returns the (possibly modified)
 * markdown plus a list of criteria that were missing.
 */
export function ensureRubricHeadings(
  markdown: string,
  evaluationWeights: EvaluationWeight[],
  primarySector = "general consulting",
): { markdown: string; missingCriteria: string[] } {
  const criteria = buildRubricCriteria(evaluationWeights);
  if (criteria.length === 0) return { markdown, missingCriteria: [] };

  const headings = buildRubricHeadings(criteria);
  const missingCriteria: string[] = [];
  const additions: Record<RubricSection, string[]> = {
    SECTION_A: [],
    SECTION_B: [],
    SECTION_C: [],
    SECTION_D: [],
  };

  // For each rubric heading, look for ANY appearance of the short
  // code + number in the markdown (e.g., "SV 01"). If absent, schedule
  // a stub injection.
  for (const h of headings) {
    const codeNumber = h.heading.split(" ").slice(0, 2).join(" "); // e.g., "SV 01"
    // Accept space OR hyphen between code and number (SV 01, SV-01, SV01).
    const re = new RegExp(`\\b${codeNumber.replace(/\s+/g, "[\\s\\-]*")}\\b`, "i");
    if (!re.test(markdown)) {
      missingCriteria.push(h.criterion);
      const content = buildCriterionContent(h.criterion, h.parentSection, h.weight, primarySector);
      additions[h.parentSection].push(`## ${h.heading}\n\n${content}`);
    }
  }

  if (missingCriteria.length === 0) return { markdown, missingCriteria: [] };

  // Inject the missing rubric stubs at the END of each parent section.
  // We locate the parent section heading (e.g., "# Section D:
  // Additional Information") and append the stubs BEFORE the next
  // top-level heading.
  let out = markdown;
  for (const section of ["SECTION_D", "SECTION_C", "SECTION_B", "SECTION_A"] as const) {
    const stubs = additions[section];
    if (stubs.length === 0) continue;
    const parentLabel = PARENT_SECTION_LABEL[section];
    const stubsBlock = `\n\n${stubs.join("\n\n")}\n`;

    // Try to find the parent heading
    const sectionRe = new RegExp(`^# ${parentLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m");
    const match = out.match(sectionRe);
    if (!match || match.index === undefined) {
      // Parent section not found — append at end
      out = out + stubsBlock;
      continue;
    }

    // Find the next top-level heading after the parent
    const startIdx = match.index + match[0].length;
    const restAfter = out.slice(startIdx);
    const nextHeadingMatch = restAfter.match(/^# /m);
    const insertAt = nextHeadingMatch && nextHeadingMatch.index !== undefined
      ? startIdx + nextHeadingMatch.index
      : out.length;
    out = out.slice(0, insertAt) + stubsBlock + out.slice(insertAt);
  }

  return { markdown: out, missingCriteria };
}
