/**
 * Scope and Discipline Crosswalk
 *
 * Creates a source-grounded crosswalk covering all six scope workstreams
 * and all required healthcare disciplines. Each required discipline must
 * map to a named, reviewed expert or an explicitly reviewed and
 * tender-permitted subcontracting arrangement.
 *
 * An unnamed "specialist to be engaged" must NOT satisfy the
 * biomedical-engineer requirement (or any other mandatory discipline).
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type ScopeWorkstreamCoverage = {
  id: string;
  name: string;
  /** The proposal section that covers this workstream. */
  proposalSection: string;
  /** Source wording from the tender. */
  sourceWording: string;
  /** Source page. */
  sourcePage: number | null;
  /** Whether this workstream is covered. */
  coverageState: "covered" | "partial" | "missing";
};

export type DisciplineAssignment = {
  id: string;
  name: string;
  functionalArea: string;
  /** The named, reviewed expert assigned to this discipline. */
  expertId: string | null;
  expertName: string | null;
  /** Whether an unnamed subcontractor is permitted for this discipline. */
  allowsUnnamedSubcontractor: boolean;
  /** Whether this is a tender-permitted subcontracting arrangement. */
  isTenderPermittedSubcontractor: boolean;
  /** Whether this discipline is satisfied. */
  isSatisfied: boolean;
  /** The reason if not satisfied. */
  unsatisfiedReason: string | null;
};

export type ScopeDisciplineCrosswalk = {
  workstreams: ScopeWorkstreamCoverage[];
  disciplines: DisciplineAssignment[];
};

// ─── Six scope workstreams ──────────────────────────────────────────────────

export const SIX_SCOPE_WORKSTREAMS = [
  "Facility identification and technical assessment",
  "Conceptual and detailed architectural design",
  "Engineering coordination",
  "Regulatory compliance and approvals",
  "Renovation planning and implementation oversight",
  "Project close-out support",
] as const;

// ─── Fourteen required healthcare disciplines ───────────────────────────────

export const FOURTEEN_HEALTHCARE_DISCIPLINES = [
  "Emergency",
  "OPD",
  "In-patient",
  "Laboratory",
  "Imaging/Radiology",
  "Pharmacy",
  "Architecture",
  "Structural engineering",
  "Mechanical systems",
  "Electrical systems",
  "Plumbing/sanitary systems",
  "Medical gas",
  "IT and telehealth",
  "Biomedical engineering",
] as const;

/**
 * Disciplines that MUST have a named, reviewed expert.
 * An unnamed "specialist to be engaged" does NOT satisfy these.
 */
export const MANDATORY_NAMED_EXPERT_DISCIPLINES = new Set([
  "Biomedical engineering",
  "Architecture",
  "Structural engineering",
]);

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Check if a discipline assignment is satisfied.
 *
 * A discipline is satisfied when:
 *   - A named, reviewed expert is assigned (expertId + expertName), OR
 *   - An unnamed subcontractor is permitted AND the tender explicitly
 *     permits subcontracting for this discipline.
 *
 * An unnamed "specialist to be engaged" does NOT satisfy:
 *   - Biomedical engineering
 *   - Architecture
 *   - Structural engineering
 */
export function isDisciplineSatisfied(assignment: {
  name: string;
  expertId: string | null;
  expertName: string | null;
  allowsUnnamedSubcontractor: boolean;
  isTenderPermittedSubcontractor: boolean;
}): { satisfied: boolean; reason: string | null } {
  // Named expert → satisfied
  if (assignment.expertId && assignment.expertName && assignment.expertName.trim()) {
    return { satisfied: true, reason: null };
  }

  // No named expert — check if unnamed subcontractor is permitted
  const isMandatoryNamed = MANDATORY_NAMED_EXPERT_DISCIPLINES.has(assignment.name);

  if (isMandatoryNamed) {
    return {
      satisfied: false,
      reason: `Discipline "${assignment.name}" requires a named, reviewed expert. An unnamed "specialist to be engaged" does not satisfy this requirement.`,
    };
  }

  // Non-mandatory discipline — unnamed subcontractor OK if tender permits
  if (assignment.allowsUnnamedSubcontractor && assignment.isTenderPermittedSubcontractor) {
    return { satisfied: true, reason: null };
  }

  if (assignment.allowsUnnamedSubcontractor && !assignment.isTenderPermittedSubcontractor) {
    return {
      satisfied: false,
      reason: `Discipline "${assignment.name}" allows an unnamed subcontractor, but the tender does not explicitly permit subcontracting. Assign a named expert or confirm tender permits subcontracting.`,
    };
  }

  return {
    satisfied: false,
    reason: `Discipline "${assignment.name}" has no assigned expert.`,
  };
}

/**
 * Verify the complete crosswalk. Returns an array of unsatisfied disciplines
 * (empty if all satisfied).
 */
export function validateCrosswalk(crosswalk: {
  disciplines: Array<{
    name: string;
    expertId: string | null;
    expertName: string | null;
    allowsUnnamedSubcontractor: boolean;
    isTenderPermittedSubcontractor: boolean;
  }>;
}): Array<{ discipline: string; reason: string }> {
  const unsatisfied: Array<{ discipline: string; reason: string }> = [];
  for (const d of crosswalk.disciplines) {
    const result = isDisciplineSatisfied(d);
    if (!result.satisfied && result.reason) {
      unsatisfied.push({ discipline: d.name, reason: result.reason });
    }
  }
  return unsatisfied;
}

/**
 * Check if the crosswalk blocks final export.
 *
 * Final export is blocked when ANY mandatory discipline is unsatisfied.
 * Drafting is never blocked — this only blocks final export.
 */
export function crosswalkBlocksFinalExport(crosswalk: ScopeDisciplineCrosswalk): {
  blocked: boolean;
  reasons: string[];
} {
  const unsatisfied = validateCrosswalk(crosswalk);
  return {
    blocked: unsatisfied.length > 0,
    reasons: unsatisfied.map((u) => u.reason),
  };
}
