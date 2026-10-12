// The tender's own evaluation criteria, as AI Analyze recorded them with a
// source page and quote (Tender.evaluationCriteriaSourceJson).
//
// Section F of run 36074770709 said it listed "each evaluation criterion
// stated in the tender ... in the tender's own wording" and then printed five
// criteria the tender does not state ("Team qualifications and comparable
// previous roles", "Company capacity", ...). They came from a sector keyword
// detector over the tender text, used even though the analysis had stored the
// tender's five criteria verbatim with page references. When the source-
// grounded list exists it is the authority; the detector remains the fallback
// for a tender analysed without it.

export interface GroundedCriterion {
  criterion: string;
  /** The weight as the tender states it, or null when it states none. */
  weight: string | null;
  sourcePage: number | null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function weightText(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return `${value}%`;
  const raw = text(value);
  if (!raw || /^(?:null|none|n\/?a|not\s+stated|—|-)$/i.test(raw)) return null;
  return /^\d+(?:\.\d+)?$/.test(raw) ? `${raw}%` : raw;
}

export function sourceGroundedEvaluationCriteria(json: string | null | undefined): GroundedCriterion[] {
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const out: GroundedCriterion[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const criterion = text(record.criterion ?? record.name ?? record.title);
    // A criterion is stated only when the analysis kept the quote it came from.
    const quote = text(record.sourceQuote ?? record.quote);
    if (criterion.length < 3 || !quote) continue;
    const key = criterion.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const page = Number(record.sourcePage ?? record.page);
    out.push({
      criterion,
      weight: weightText(record.weight),
      sourcePage: Number.isFinite(page) && page > 0 ? page : null,
    });
  }
  return out;
}
