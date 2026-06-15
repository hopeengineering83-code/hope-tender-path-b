export const PLAN_PROVENANCE_VALUES = [
  "TENDER_REQUIREMENT",
  "EXACT_FILE_INSTRUCTION",
  "DERIVED_DRAFT",
  "MANUAL",
  "LEGACY",
] as const;

export type PlanProvenance = (typeof PLAN_PROVENANCE_VALUES)[number];

export type PlanProvenanceSnapshot = {
  planProvenance?: string | null;
  planConfirmedAt?: Date | string | null;
  planConfirmedBy?: string | null;
  planSourceRequirementIds?: string | null;
  contentSummary?: string | null;
};

export function normalizePlanProvenance(value: string | null | undefined): PlanProvenance | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  return (PLAN_PROVENANCE_VALUES as readonly string[]).includes(normalized)
    ? (normalized as PlanProvenance)
    : null;
}

export function resolvePlanProvenance(snapshot: PlanProvenanceSnapshot): PlanProvenance | null {
  const structured = normalizePlanProvenance(snapshot.planProvenance);
  if (structured) return structured;
  if (snapshot.contentSummary?.includes("DERIVED_DRAFT_UNCONFIRMED")) return "DERIVED_DRAFT";
  return null;
}

export function requiresPlanConfirmation(snapshot: PlanProvenanceSnapshot): boolean {
  return resolvePlanProvenance(snapshot) === "DERIVED_DRAFT" && !snapshot.planConfirmedAt;
}

export function derivePlanProvenance(input: {
  isDerivedDraft: boolean;
  sourceRequirementIds?: string[] | null;
}): PlanProvenance {
  if (input.isDerivedDraft) return "DERIVED_DRAFT";
  if ((input.sourceRequirementIds?.length ?? 0) > 0) return "TENDER_REQUIREMENT";
  return "EXACT_FILE_INSTRUCTION";
}

export function serializePlanSourceRequirementIds(ids: string[] | null | undefined): string {
  return JSON.stringify([...new Set((ids ?? []).filter((id) => typeof id === "string" && id.trim().length > 0))]);
}

export function parsePlanSourceRequirementIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}
