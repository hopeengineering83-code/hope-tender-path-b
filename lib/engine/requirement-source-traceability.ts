// Canonical requirement source-traceability predicates.
//
// Four different definitions of "traced" had grown up independently, and they
// disagreed on the same tender. On a real Preview tender the UI simultaneously
// showed:
//
//   • "Trusted traced requirements (mandatory): 4/4"   (next-action panel)
//   • "Grounding 100"                                   (analysis quality)
//   • "Extracted requirements have no source traceability." (bid strategy)
//
// All three were reading the same four requirements. The disagreement was
// entirely in the predicate:
//
//   lib/tender-readiness-state.ts   page>0 OR quote OR sectionReference OR confidence>0
//   lib/engine/workflow/workflow-state.ts   fileId OR page
//   app/api/tenders/[id]/bid-strategy   confidence > 0        ← the outlier
//   build-plan gates                 fileId AND page AND quote  (strict grounding)
//
// `sourceConfidence` is an AI-SUPPLIED score. mapToDraft stores
// `sourceTenderFileId ? (req.sourceConfidence ?? 0) : 0`, so a requirement that
// is fully grounded — real active file, proven page, verbatim quote — still
// carries 0 whenever the model omitted the field. Treating that single optional
// number as the test for "has any source traceability" reports perfectly
// traceable requirements as untraceable, which is what the screenshot showed.
//
// These two predicates name the two questions that actually get asked, so a
// caller has to pick one deliberately instead of inventing a third:
//
//   hasSourceTraceability  — is there ANY real anchor back to a source document?
//   isFullyGrounded        — does it meet the STRICT bar the export gates enforce?
//
// Neither uses sourceConfidence as evidence of traceability. Confidence ranks
// how sure the model was; it is not an anchor, and its absence is not proof of
// absence.

export type RequirementSourceFields = {
  sourceTenderFileId?: string | null;
  sourcePageNumber?: number | null;
  sourceExactQuote?: string | null;
  sectionReference?: string | null;
  sourceConfidence?: number | null;
};

/** Minimum quote length that counts as meaningful, matching the Build Plan gate. */
export const MEANINGFUL_QUOTE_MIN_CHARS = 10;

function hasFile(r: RequirementSourceFields): boolean {
  return typeof r.sourceTenderFileId === "string" && r.sourceTenderFileId.trim().length > 0;
}

function hasPage(r: RequirementSourceFields): boolean {
  return typeof r.sourcePageNumber === "number" && Number.isInteger(r.sourcePageNumber) && r.sourcePageNumber > 0;
}

function hasQuote(r: RequirementSourceFields, minChars = MEANINGFUL_QUOTE_MIN_CHARS): boolean {
  return typeof r.sourceExactQuote === "string" && r.sourceExactQuote.trim().length >= minChars;
}

/**
 * Does this requirement carry ANY real anchor back to a source document?
 *
 * Deliberately inclusive — a file reference, a page, a quote, or a section
 * heading each anchor the requirement to something a reviewer can open. Used by
 * advisory surfaces that only need to know whether extraction produced
 * traceable output at all.
 */
export function hasSourceTraceability(r: RequirementSourceFields): boolean {
  return hasFile(r) || hasPage(r) || hasQuote(r, 1) || Boolean((r.sectionReference ?? "").trim());
}

/**
 * Does this requirement meet the STRICT grounding bar the generation and export
 * gates enforce: a real source file, a proven page, and a meaningful quote?
 *
 * Use this anywhere the answer authorizes work. `hasSourceTraceability` is not
 * a substitute — it answers a weaker question on purpose.
 */
export function isFullyGrounded(r: RequirementSourceFields): boolean {
  return hasFile(r) && hasPage(r) && hasQuote(r);
}

/** Count of requirements carrying any source anchor. */
export function countTraceable(requirements: readonly RequirementSourceFields[]): number {
  return requirements.filter(hasSourceTraceability).length;
}

/** Count of requirements meeting the strict grounding bar. */
export function countFullyGrounded(requirements: readonly RequirementSourceFields[]): number {
  return requirements.filter(isFullyGrounded).length;
}
