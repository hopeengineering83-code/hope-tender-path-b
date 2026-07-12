export type AnalysisRequirementResultLike = {
  requirements?: unknown[] | null;
} | null | undefined;

/**
 * Return the number of actual merged requirements in an analysis result.
 *
 * Chunk count is execution telemetry and must never be presented as the number
 * of tender requirements. Unknown or malformed results fail closed to zero.
 */
export function getExtractedRequirementCount(
  result: AnalysisRequirementResultLike,
): number {
  return Array.isArray(result?.requirements) ? result.requirements.length : 0;
}
