export const HEALTHCARE_UNWEIGHTED_CRITERIA = [
  "clinical_service_scope",
  "patient_safety_and_quality",
  "healthcare_staffing",
  "medical_equipment_and_maintenance",
  "infection_prevention_and_control",
] as const;

export type CriterionCoverage = { criterion: string; covered: boolean; evidenceIds: string[]; blocker: string | null };

export function buildCriterionCoverage(criteria: readonly string[], evidenceByCriterion: Readonly<Record<string, readonly string[]>>): CriterionCoverage[] {
  return [...new Set(criteria.map((item) => item.trim()).filter(Boolean))].map((criterion) => {
    const evidenceIds = [...new Set(evidenceByCriterion[criterion] ?? [])].filter(Boolean);
    return { criterion, covered: evidenceIds.length > 0, evidenceIds, blocker: evidenceIds.length ? null : "CRITERION_EVIDENCE_MISSING" };
  });
}

export function allCriteriaCovered(rows: readonly CriterionCoverage[]): boolean {
  return rows.length > 0 && rows.every((row) => row.covered);
}
