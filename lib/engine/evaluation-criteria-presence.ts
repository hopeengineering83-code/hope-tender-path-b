type EvaluationCriteriaInput = {
  evaluationMethodology?: string | null;
  evaluationCriteriaSourceJson?: string | null;
  files?: Array<{ extractedText?: string | null }>;
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
 * Canonical presence test for source evaluation criteria. Numeric weights are
 * deliberately not required: a source can state qualitative selection factors
 * without publishing a scoring allocation.
 */
export function hasSourceEvaluationCriteria(input: EvaluationCriteriaInput): boolean {
  if ((input.evaluationMethodology ?? "").trim().length > 20) return true;
  if (hasStructuredCriteria(input.evaluationCriteriaSourceJson)) return true;

  const source = (input.files ?? []).map((file) => file.extractedText ?? "").join("\n");
  if (!source.trim()) return false;

  // Require a criteria heading/lead-in plus actual criterion content. This
  // avoids treating statements such as "evaluation criteria were not provided"
  // as evidence that criteria exist.
  const section = source.match(
    /(?:evaluation|selection|award|qualification)\s+(?:criteria|factors|methodology|framework)|technical\s+evaluation/i,
  );
  if (!section) return false;
  const tail = source.slice(section.index ?? 0, (section.index ?? 0) + 4000);
  if (/criteria\s+(?:were|are|is)?\s*(?:not\s+(?:provided|stated|specified|published)|absent|unavailable)/i.test(tail.slice(0, 240))) return false;

  return /(?:^|\n)\s*(?:[-*•]|\d+[.)]|[a-z][.)])\s+\S.{3,}|\b(?:experience|methodology|approach|team|personnel|portfolio|compliance|capacity|responsiveness|technical\s+merit|quality)\b/i.test(tail);
}
