-- Record WHICH resolved models a provider failure was observed under.
--
-- A failure is evidence about a (provider, model) pair. "This model is not
-- available in your subscription tier" says nothing about a different model on
-- the same key. Without this column, a cooldown earned by a model the operator
-- has since replaced goes on suppressing the provider for the rest of its
-- backoff (up to 160 minutes), so the operator's own fix appears not to work.
--
-- Additive and nullable: existing rows carry NULL and behave exactly as before.
-- Model identifiers only — never a key, a base URL, or a prompt.
ALTER TABLE "ProviderHealthSnapshot"
  ADD COLUMN IF NOT EXISTS "failureConfigFingerprint" TEXT;
