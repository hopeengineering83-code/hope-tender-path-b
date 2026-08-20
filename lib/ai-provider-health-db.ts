import { logger } from "./observability";
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
  restoreBillingLockout,
  getProviderStateSnapshot,
} from "./ai-provider-health";
import { CANONICAL_AI_PROVIDER_ORDER } from "./ai-provider-registry";

// Persistence iteration follows the canonical registry order so operator-facing
// artifacts (DB rows, logs, snapshots) read in that same order. The order is
// NOT restated here — it is imported. The comment that used to spell it out had
// gone stale, which is the whole reason the order lives in exactly one file.
// This list is not a fallback chain: it only governs read/write order of
// ProviderHealthSnapshot rows.
const ALL_PROVIDERS: readonly AiProviderName[] = CANONICAL_AI_PROVIDER_ORDER;

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
      if (!ALL_PROVIDERS.includes(snap.provider as AiProviderName)) continue;

      const storedCooldownMs = snap.cooldownUntil ? snap.cooldownUntil.getTime() : null;
      // An expired cooldown means "the cooldown is over", not "forget this
      // provider". The previous code did `continue` here, discarding the whole
      // row — including the capability timestamps that record what the provider
      // was proven able to do. A provider that had completed a real AI Analyze
      // and later hit one transient rate limit therefore came back from every
      // cold start as never-verified, and health under-reported a working
      // provider for as long as the deployment lived.
      //
      // Drop the expired cooldown; keep everything else.
      const cooldownUntilMs = storedCooldownMs && storedCooldownMs > now ? storedCooldownMs : null;

      // Staleness applies to FAILURE state only. A recorded success does not go
      // stale in a way that makes it wrong to remember — the provider really did
      // answer — so a proven capability is always restored.
      const hasVerifiedCapability = Boolean(
        snap.lastPingSucceededAt || snap.lastAnalysisSucceededAt || snap.lastGenerationSucceededAt,
      );
      const failureIsStale = Boolean(
        snap.lastFailureAt && now - snap.lastFailureAt.getTime() > 10 * 60_000 && !cooldownUntilMs,
      );
      if (failureIsStale && !hasVerifiedCapability) continue;

      // A provider that answered with a demand for payment must stay excluded on
      // THIS instance too, not be rediscovered by spending another attempt.
      if (snap.lastFailureCategory === "BILLING") {
        restoreBillingLockout(
          snap.provider as AiProviderName,
          snap.lastFailureAt ? snap.lastFailureAt.getTime() : now,
          snap.lastSafeErrorMessage ?? "Provider requires payment.",
        );
      }

      restoreProviderState(snap.provider as AiProviderName, {
        lastSuccessAt: snap.lastSuccessAt ? snap.lastSuccessAt.getTime() : null,
        lastPingSucceededAt: snap.lastPingSucceededAt ? snap.lastPingSucceededAt.getTime() : null,
        lastGenerationSucceededAt: snap.lastGenerationSucceededAt ? snap.lastGenerationSucceededAt.getTime() : null,
        lastAnalysisSucceededAt: snap.lastAnalysisSucceededAt ? snap.lastAnalysisSucceededAt.getTime() : null,
        lastFailureAt: failureIsStale ? null : snap.lastFailureAt ? snap.lastFailureAt.getTime() : null,
        lastFailureCategory: failureIsStale ? null : ((snap.lastFailureCategory as AiProviderFailureCategory | null) ?? null),
        lastFailureMessage: failureIsStale ? null : (snap.lastSafeErrorMessage ?? null),
        consecutiveFailures: failureIsStale ? 0 : snap.consecutiveFailures,
        cooldownUntil: cooldownUntilMs,
      });
    }
    restoredAt = now;
    return { restored: true, skipped: false, warning: null };
  } catch (err) {
    const warning = "Provider health DB restore failed; using in-memory provider health for this response.";
    logger.warn("[ai-health-db] Failed to restore provider health from DB:", { detail: err instanceof Error ? err.message : String(err) });
    return { restored: false, skipped: false, warning };
  }
}

// Bounded versions of restore/persist that race against a timeout.
// A slow ProviderHealthSnapshot read must not consume the worker's AI
// budget. If the DB is slow, fall back to in-memory state.
export async function restoreHealthFromDbBounded(timeoutMs = 2_000): Promise<ProviderHealthRestoreResult> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      restoreHealthFromDb(),
      new Promise<ProviderHealthRestoreResult>((resolve) => {
        timeout = setTimeout(() => resolve({
          restored: false,
          skipped: false,
          warning: `Provider health DB restore timed out after ${timeoutMs}ms; using in-memory provider health for this response.`,
        }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function persistAllHealthToDbBounded(timeoutMs = 1_500): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      persistAllHealthToDb(),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export const __testing__ = { resetRestoreGuard: () => { restoredAt = null; } };

export async function persistAllHealthToDb(): Promise<void> {
  try {
    for (const provider of ALL_PROVIDERS) {
      const s = getProviderStateSnapshot(provider); if (!s) continue;
      // Skip providers with no recorded state (avoids unnecessary writes).
      //
      // The capability timestamps have to be part of "has state". This tested
      // only lastSuccessAt and lastFailureAt, but recordProviderPingSuccess sets
      // lastPingSucceededAt alone — so a connectivity-verified provider matched
      // neither and was never written. CONNECTIVITY_VERIFIED could not survive a
      // cold start, and the diagnostic that established it was forgotten the
      // moment the instance was recycled.
      const hasState = Boolean(
        s.lastSuccessAt || s.lastFailureAt || s.lastPingSucceededAt
        || s.lastAnalysisSucceededAt || s.lastGenerationSucceededAt,
      );
      if (!hasState) continue;

      const fields = {
        lastSuccessAt: s.lastSuccessAt ? new Date(s.lastSuccessAt) : null,
        lastPingSucceededAt: s.lastPingSucceededAt ? new Date(s.lastPingSucceededAt) : null,
        lastAnalysisSucceededAt: s.lastAnalysisSucceededAt ? new Date(s.lastAnalysisSucceededAt) : null,
        lastGenerationSucceededAt: s.lastGenerationSucceededAt ? new Date(s.lastGenerationSucceededAt) : null,
        lastFailureAt: s.lastFailureAt ? new Date(s.lastFailureAt) : null,
        lastFailureCategory: s.lastFailureCategory,
        lastSafeErrorMessage: s.lastFailureMessage,
        consecutiveFailures: s.consecutiveFailures,
        cooldownUntil: s.cooldownUntil ? new Date(s.cooldownUntil) : null,
      };
      await prisma.providerHealthSnapshot.upsert({
        where: { provider },
        update: fields,
        create: { provider, ...fields },
      });
    }
  } catch (err) {
    logger.warn("[ai-health-db] Failed to persist provider health to DB:", { detail: err instanceof Error ? err.message : String(err) });
  }
}
