/**
 * Section C's Work Plan and Schedule table.
 *
 * ONE WORK PLAN, NOT THREE
 * ------------------------
 * A delivered proposal carried three phase lists that disagreed with each
 * other. Nine pages apart it said:
 *
 *   C.4  "Phase 1: Site / Premises Assessment ... Phase 6: Close-Out"
 *   C.13 "The engagement is delivered in 5 phases"
 *   C.16 "The methodology is delivered across 5 phases over an indicative
 *         90-day engagement window"  (Inception, Days 1-13 ...)
 *
 * C.13 and C.16 already render the canonical spine in canonical-work-plan.ts.
 * This module owned the third list — a private six-phase sector table whose
 * phase names, deliverables and durations matched neither. An evaluator
 * reading the work plan could not tell which of the three was the offer.
 *
 * It now renders the same spine as every other representation, and stamps the
 * phasing marker so methodology-tables.ts recognises the work plan as already
 * present and does not inject a second table of the same rows. The table keeps
 * its own heading and position, because the compliance mapping and the Section
 * C numbering authority both point requirements at "C.6 Work Plan and
 * Schedule"; only the phase content is now shared.
 */

import { canonicalWorkPlan } from "./canonical-work-plan";

function escCell(text: string): string {
  return text.replace(/\r?\n+/g, " ").replace(/\|/g, "/").replace(/\s{2,}/g, " ").trim();
}

export function buildWorkPlanTable(opts: { primarySector: string; totalDays?: number }): string {
  const phases = canonicalWorkPlan({ sector: opts.primarySector, totalDays: opts.totalDays });
  const rows = phases.map(
    (p) => `| ${escCell(p.title)} | ${escCell(p.deliverables)} | ${escCell(p.responsibleRole)} | ${escCell(p.durationLabel)} |`,
  );

  const intro = opts.totalDays
    ? `The engagement is delivered in ${phases.length} phases over ${opts.totalDays} calendar days. Each phase produces a named deliverable, carries a documented hand-off, and requires written client sign-off before the next phase commences.`
    : `The engagement is delivered in ${phases.length} phases. Each phase produces a named deliverable, carries a documented hand-off, and requires written client sign-off before the next phase commences.`;

  return [
    // Recognised by methodology-tables.ts detectExisting() as the phasing
    // table, so the same rows are never emitted twice under two headings.
    "<!-- methodology-table:phasing -->",
    "## C.6 Work Plan and Schedule",
    intro,
    "",
    "| Phase | Key Deliverables | Responsible Role | Indicative Duration |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}
