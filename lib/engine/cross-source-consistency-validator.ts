export type SourceFact = { field: string; value: string; sourceFileId: string; sourcePage: number; sourceQuote: string };
export type SourceConflict = { field: string; normalizedValues: string[]; sourceFileIds: string[]; blockerCode: "CROSS_SOURCE_CONFLICT" };

const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

export function validateCrossSourceConsistency(facts: readonly SourceFact[]): SourceConflict[] {
  const byField = new Map<string, SourceFact[]>();
  for (const fact of facts) {
    if (!fact.field || !fact.sourceFileId || fact.sourcePage < 1 || fact.sourceQuote.trim().length < 6) continue;
    byField.set(fact.field, [...(byField.get(fact.field) ?? []), fact]);
  }
  const conflicts: SourceConflict[] = [];
  for (const [field, rows] of byField) {
    const values = [...new Set(rows.map((row) => normalize(row.value)).filter(Boolean))];
    if (values.length > 1) conflicts.push({ field, normalizedValues: values, sourceFileIds: [...new Set(rows.map((row) => row.sourceFileId))], blockerCode: "CROSS_SOURCE_CONFLICT" });
  }
  return conflicts;
}
