type EvaluationCriteriaInput = {
  evaluationMethodology?: string | null;
  evaluationCriteriaSourceJson?: string | null;
};

function hasStructuredCriteria(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.some((entry) => {
      if (typeof entry === "string") return entry.trim().length > 2;
      if (!entry || typeof entry !== "object") return false;
      const record = entry as Record<string, unknown>;
      return [record.criterion, record.title, record.name, record.description]
        .some((field) => typeof field === "string" && field.trim().length > 2);
    });
  } catch {
    return false;
  }
}

/**
 * Presence test for the canonical, persisted analysis facts. Source extraction
 * belongs upstream; readiness consumers must not reinterpret tender bytes and
 * create a second analysis result. Numeric weights are deliberately optional.
 */
export function hasSourceEvaluationCriteria(input: EvaluationCriteriaInput): boolean {
  if ((input.evaluationMethodology ?? "").trim().length > 20) return true;
  return hasStructuredCriteria(input.evaluationCriteriaSourceJson);
}
