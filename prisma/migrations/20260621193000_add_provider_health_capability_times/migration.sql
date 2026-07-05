-- Add capability-specific success timestamps to ProviderHealthSnapshot so a
-- cold start can restore connectivity/analysis/generation verification state
-- (not just a generic last-success time). Safe metadata only — no keys,
-- prompts, or raw provider bodies are ever stored.
ALTER TABLE "ProviderHealthSnapshot"
  ADD COLUMN IF NOT EXISTS "lastPingSucceededAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastAnalysisSucceededAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastGenerationSucceededAt" TIMESTAMP(3);
