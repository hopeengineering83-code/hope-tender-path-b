export const SCOPE_WORKSTREAMS = ["discovery", "design", "delivery", "commissioning", "operations", "assurance"] as const;
export const SCOPE_DISCIPLINES = [
  "architecture", "civil", "structural", "mechanical", "electrical", "plumbing", "medical_planning",
  "biomedical", "ict", "quantity_surveying", "environmental", "health_and_safety", "project_management", "quality_assurance",
] as const;
export type ScopeWorkstream = typeof SCOPE_WORKSTREAMS[number];
export type ScopeDiscipline = typeof SCOPE_DISCIPLINES[number];
export type ScopeCrosswalkRow = { workstream: ScopeWorkstream; disciplines: ScopeDiscipline[] };

export function buildScopeDisciplineCrosswalk(assignments: readonly { workstream: string; discipline: string }[]): ScopeCrosswalkRow[] {
  return SCOPE_WORKSTREAMS.map((workstream) => ({
    workstream,
    disciplines: SCOPE_DISCIPLINES.filter((discipline) => assignments.some((row) => row.workstream === workstream && row.discipline === discipline)),
  }));
}
