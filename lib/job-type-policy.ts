import type { JobType } from "./ai-jobs";

export const SUPPORTED_JOB_TYPES = [
  "PROPOSAL_GENERATION",
  "EVALUATOR_SIM",
  "COPILOT_DEEP_ANALYSIS",
  "PROFILE_FACT_EXTRACTION",
  "AI_ANALYZE",
  "ENGINE_RUN",
  "EXTRACT_TEXT",
  "VAULT_INGEST",
] as const satisfies readonly JobType[];

export type ParsedJobType =
  | { ok: true; value?: JobType }
  | { ok: false; code: "INVALID_JOB_TYPE" };

export function parseJobTypeFilter(raw: string | null): ParsedJobType {
  if (raw === null || raw.trim() === "") return { ok: true };
  const value = raw.trim();
  if ((SUPPORTED_JOB_TYPES as readonly string[]).includes(value)) {
    return { ok: true, value: value as JobType };
  }
  return { ok: false, code: "INVALID_JOB_TYPE" };
}
