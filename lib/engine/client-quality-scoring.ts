export const CLIENT_QUALITY_DIMENSIONS = [
  "source_grounding", "criterion_coverage", "scope_alignment", "requirement_completeness", "consistency",
  "client_output_separation", "artifact_integrity", "submission_compliance", "review_completion",
] as const;
export type ClientQualityDimension = typeof CLIENT_QUALITY_DIMENSIONS[number];
export type ClientQualityScore = { score: number; blocked: boolean; dimensions: Record<ClientQualityDimension, number>; blockers: string[] };

export function scoreClientQuality(input: Partial<Record<ClientQualityDimension, number>>, blockers: readonly string[] = []): ClientQualityScore {
  const dimensions = Object.fromEntries(CLIENT_QUALITY_DIMENSIONS.map((key) => [key, Math.max(0, Math.min(100, Math.round(input[key] ?? 0))) ])) as Record<ClientQualityDimension, number>;
  const score = Math.round(CLIENT_QUALITY_DIMENSIONS.reduce((sum, key) => sum + dimensions[key], 0) / CLIENT_QUALITY_DIMENSIONS.length);
  return { score: blockers.length ? Math.min(score, 99) : score, blocked: blockers.length > 0, dimensions, blockers: [...new Set(blockers)] };
}
