// One rule for "the tender REQUIRES evidence of this type".
//
// 2026-09-30, Preview, a telecom-tower EOI: "Previous Telecommunications Tower
// Experience" was a SCORED row, and every one of the firm's building projects
// was correctly hard-excluded for it. Four separate places still read "the
// tender requires project references" from the mere presence of a
// PROJECT_EXPERIENCE row: the engine postcondition, the generator's
// zero-evidence guard, canonical readiness and export readiness. Each in turn
// withheld a bid the tender does not forbid. A scored criterion the firm
// cannot evidence costs points and stays visible as a compliance gap; only a
// MANDATORY/CRITICAL row makes missing evidence a hard stop.

export const MANDATORY_EVIDENCE_PRIORITIES = ["MANDATORY", "CRITICAL"] as const;

export function isMandatoryPriority(priority: string | null | undefined): boolean {
  return /^(?:MANDATORY|CRITICAL)$/i.test(String(priority ?? "").trim());
}

export function requiresEvidenceOfType(
  requirements: ReadonlyArray<{ requirementType?: string | null; priority?: string | null }>,
  types: readonly string[],
): boolean {
  return requirements.some((row) => types.includes(String(row.requirementType ?? "")) && isMandatoryPriority(row.priority));
}
