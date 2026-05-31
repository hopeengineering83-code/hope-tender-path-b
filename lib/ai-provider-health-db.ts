// DB-backed persistence layer for provider health state.
//
// The in-memory tracker in lib/ai-provider-health.ts resets on every
// Vercel cold start. This module persists cooldown state to the
// ProviderHealthSnapshot table so the next cold start can restore active
// cooldowns before the first provider call.
//
// Design rules:
//   - Never throws: all DB errors are caught and logged, never propagated.
//   - Never stores API keys, raw prompts, or full provider responses.
//   - restoreHealthFromDb() is idempotent and safe to call on every request;
//     module-level de-duplication prevents redundant DB reads.
//   - persistAllHealthToDb() writes the current in-memory state for all providers.

import { prisma } from "./prisma";
import {
  type AiProviderName,
  type AiProviderFailureCategory,
  restoreProviderState,
  getProviderStateSnapshot,
} from "./ai-provider-health";

const ALL_PROVIDERS: AiProviderName[] = ["anthropic", "gemini", "openai", "deepseek", "groq", "openrouter"];

// Module-level guard: only restore from DB once per instance lifetime.
// Subsequent calls are no-ops so per-request overhead is zero after the first call.
let restoredAt: number | null = null;
const RESTORE_ONCE_MS = 5 * 60_000; // re-allow restore after 5 min (handles long-lived instances)

export type ProviderHealthRestoreResult = {
  restored: boolean;
  skipped: boolean;
  warning: string | null;
};

export async function restoreHealthFromDb(): Promise<ProviderHealthRestoreResult> {
  const now = Date.now();
  if (restoredAt !== null && now - restoredAt < RESTORE_ONCE_MS) return { restored: false, skipped: true, warning: null };

  try {
    const snapshots = await prisma.providerHealthSnapshot.findMany();
    for (const snap of snapshots) {
      const cooldownUntilMs = snap.cooldownUntil ? snap.cooldownUntil.getTime() : null;
      // Skip expired cooldowns — nothing to restore
      if (cooldownUntilMs && cooldownUntilMs <= now) continue;
      // Skip very stale records (> 10 min since last failure) to avoid
      // carrying forward state from a much earlier run
      if (snap.lastFailureAt && now - snap.lastFailureAt.getTime() > 10 * 60_000 && !cooldownUntilMs) continue;

      if (!ALL_PROVIDERS.includes(snap.provider as AiProviderName)) continue;

      restoreProviderState(snap.provider as AiProviderName, {
        lastSuccessAt: snap.lastSuccessAt ? snap.lastSuccessAt.getTime() : null,
        lastFailureAt: snap.lastFailureAt ? snap.lastFailureAt.getTime() : null,
        lastFailureCategory: (snap.lastFailureCategory as AiProviderFailureCategory | null) ?? null,
        lastFailureMessage: snap.lastSafeErrorMessage ?? null,
        consecutiveFailures: snap.consecutiveFailures,
        cooldownUntil: cooldownUntilMs,
      });
    }
    restoredAt = now;
    return { restored: true, skipped: false, warning: null };
  } catch (err) {
    const warning = "Provider health DB restore failed; using in-memory provider health for this response.";
    console.warn("[ai-health-db] Failed to restore provider health from DB:", err instanceof Error ? err.message : String(err));
    return { restored: false, skipped: false, warning };
  }
}

export const __testing__ = { resetRestoreGuard: () => { restoredAt = null; } };

export async function persistAllHealthToDb(): Promise<void> {
  try {
    for (const provider of ALL_PROVIDERS) {
      const s = getProviderStateSnapshot(provider);
      // Skip providers with no recorded state (avoids unnecessary writes)
      if (!s.lastSuccessAt && !s.lastFailureAt) continue;

      await prisma.providerHealthSnapshot.upsert({
        where: { provider },
        update: {
          lastSuccessAt: s.lastSuccessAt ? new Date(s.lastSuccessAt) : null,
          lastFailureAt: s.lastFailureAt ? new Date(s.lastFailureAt) : null,
          lastFailureCategory: s.lastFailureCategory,
          lastSafeErrorMessage: s.lastFailureMessage,
          consecutiveFailures: s.consecutiveFailures,
          cooldownUntil: s.cooldownUntil ? new Date(s.cooldownUntil) : null,
        },
        create: {
          provider,
          lastSuccessAt: s.lastSuccessAt ? new Date(s.lastSuccessAt) : null,
          lastFailureAt: s.lastFailureAt ? new Date(s.lastFailureAt) : null,
          lastFailureCategory: s.lastFailureCategory,
          lastSafeErrorMessage: s.lastFailureMessage,
          consecutiveFailures: s.consecutiveFailures,
          cooldownUntil: s.cooldownUntil ? new Date(s.cooldownUntil) : null,
        },
      });
    }
  } catch (err) {
    console.warn("[ai-health-db] Failed to persist provider health to DB:", err instanceof Error ? err.message : String(err));
  }
}
