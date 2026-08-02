import { logger } from "../observability";
import { redactSecrets } from "../sanitize-error";
// Provider health store — DB-backed persistence for cold-start recovery.
//
// This module provides a higher-level API over the ProviderHealthSnapshot table.
// It wraps lib/ai-provider-health-db.ts and lib/ai-provider-health.ts to give
// callers a single import point with the canonical markProviderFailed /
// markProviderOK / isProviderCoolingDown / getProviderHealthSummary API.
//
// Design rules:
//   - All DB calls wrapped in try/catch — DB unavailability never blocks AI calls.
//   - Never stores API keys, raw prompts, or full provider responses.
//   - Error messages are redacted before storage.
//   - loadProviderHealthIntoMemory() is idempotent: skip after first load per process.

import { prisma } from "@/lib/prisma";
import {
  recordProviderFailure,
  recordProviderSuccess,
  isProviderCooledDown,
  getProviderStateSnapshot,
  restoreProviderState,
  type AiProviderName,
  type AiProviderFailureCategory,
} from "@/lib/ai-provider-health";
import { CANONICAL_AI_PROVIDER_ORDER } from "@/lib/ai-provider-registry";

// Cooldown seconds per failure class (used for DB cooldownUntil timestamp).
// Mirrors COOLDOWN_PER_CATEGORY_MS in ai-provider-health.ts but expressed in
// seconds for clarity when writing to DB DateTimes.
const COOLDOWN_SECONDS: Record<string, number> = {
  RATE_LIMIT: 60,
  AUTH: 3600,
  QUOTA_EXHAUSTED: 300,
  MODEL_UNAVAILABLE: 120,
  NETWORK: 30,
  MALFORMED_RESPONSE: 60,
  TIMEOUT: 10,
  UNKNOWN: 60,
};

const ALL_PROVIDERS: readonly AiProviderName[] = CANONICAL_AI_PROVIDER_ORDER;

// Module-level guard: loadProviderHealthIntoMemory runs only once per process.
let healthLoaded = false;

/**
 * Redacts API keys and URLs from an error message so it is safe to store.
 * Delegates secret redaction to the canonical redactSecrets() helper so
 * patterns cannot diverge across the 5 call sites.
 */
function redactError(raw: string | null | undefined): string {
  if (!raw) return "";
  return redactSecrets(raw)
    .replace(/https?:\/\/\S+/g, "[URL_REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/**
 * Map a failure class string to an AiProviderFailureCategory.
 * QUOTA_EXHAUSTED maps to RATE_LIMIT for in-memory tracking parity.
 */
function toFailureCategory(failureClass: string): AiProviderFailureCategory {
  const map: Record<string, AiProviderFailureCategory> = {
    RATE_LIMIT: "RATE_LIMIT",
    QUOTA_EXHAUSTED: "RATE_LIMIT",
    AUTH: "AUTH",
    TIMEOUT: "TIMEOUT",
    MODEL_UNAVAILABLE: "MODEL_UNAVAILABLE",
    NETWORK: "NETWORK",
    MALFORMED_RESPONSE: "MALFORMED_RESPONSE",
    PROVIDER_ERROR: "PROVIDER_ERROR",
    UNKNOWN: "UNKNOWN",
  };
  return map[failureClass] ?? "UNKNOWN";
}

/**
 * Record a provider failure in both in-memory state and DB.
 * DB write is fire-and-forget: errors are logged but never propagated.
 */
export async function markProviderFailed(
  provider: string,
  failureClass: string,
  redactedError?: string,
): Promise<void> {
  const category = toFailureCategory(failureClass);
  const safeError = redactError(redactedError);
  // Update in-memory state immediately
  recordProviderFailure(provider as AiProviderName, new Error(safeError || failureClass));

  // Persist to DB asynchronously (fire-and-forget in hot path)
  const cooldownSeconds = COOLDOWN_SECONDS[failureClass] ?? COOLDOWN_SECONDS.UNKNOWN;
  const cooldownUntil = new Date(Date.now() + cooldownSeconds * 1_000);

  try {
    const existing = await prisma.providerHealthSnapshot.findUnique({
      where: { provider },
    });
    const consecutiveFails = (existing?.consecutiveFailures ?? 0) + 1;

    await prisma.providerHealthSnapshot.upsert({
      where: { provider },
      update: {
        lastFailureAt: new Date(),
        lastFailureCategory: category,
        lastSafeErrorMessage: safeError || null,
        consecutiveFailures: consecutiveFails,
        cooldownUntil,
      },
      create: {
        provider,
        lastFailureAt: new Date(),
        lastFailureCategory: category,
        lastSafeErrorMessage: safeError || null,
        consecutiveFailures: 1,
        cooldownUntil,
      },
    });
  } catch (err) {
    logger.warn("[provider-health-store] Failed to persist markProviderFailed:", { detail: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Record a provider success in both in-memory state and DB.
 * Resets consecutiveFailures and clears cooldown.
 */
export async function markProviderAnalysisOK(provider: string): Promise<void> {
  const { recordProviderAnalysisSuccess } = await import("@/lib/ai-provider-health");
  recordProviderAnalysisSuccess(provider as any);
  try {
    await prisma.providerHealthSnapshot.upsert({
      where: { provider },
      update: {
        lastSuccessAt: new Date(),
        consecutiveFailures: 0,
        cooldownUntil: null,
        lastFailureCategory: null,
        lastSafeErrorMessage: null,
      },
      create: {
        provider,
        lastSuccessAt: new Date(),
        consecutiveFailures: 0,
        cooldownUntil: null,
      },
    });
  } catch (err) {
    logger.warn("[provider-health-store] Failed to persist markProviderAnalysisOK:", { detail: err instanceof Error ? err.message : String(err) });
  }
}

export async function markProviderOK(provider: string): Promise<void> {
  recordProviderSuccess(provider as AiProviderName);

  try {
    await prisma.providerHealthSnapshot.upsert({
      where: { provider },
      update: {
        lastSuccessAt: new Date(),
        consecutiveFailures: 0,
        cooldownUntil: null,
        lastFailureCategory: null,
        lastSafeErrorMessage: null,
      },
      create: {
        provider,
        lastSuccessAt: new Date(),
        consecutiveFailures: 0,
        cooldownUntil: null,
      },
    });
  } catch (err) {
    logger.warn("[provider-health-store] Failed to persist markProviderOK:", { detail: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Check if a provider is currently in cooldown (DB-backed, falls back to in-memory).
 * Returns false silently if DB is unavailable.
 */
export async function isProviderCoolingDown(provider: string): Promise<boolean> {
  // Check in-memory first (fastest path)
  if (isProviderCooledDown(provider as AiProviderName)) return true;

  // Check DB for cross-instance cooldowns
  try {
    const snap = await prisma.providerHealthSnapshot.findUnique({ where: { provider } });
    if (!snap || !snap.cooldownUntil) return false;
    return snap.cooldownUntil > new Date();
  } catch {
    return false;
  }
}

/**
 * Return a summary of all provider health records from DB.
 * Used by the admin endpoint. Returns [] silently if DB is unavailable.
 */
export async function getProviderHealthSummary(): Promise<Array<{
  provider: string;
  status: string;
  cooldownUntil: Date | null;
  consecutiveFails: number;
  lastTestedAt: Date;
}>> {
  try {
    const records = await prisma.providerHealthSnapshot.findMany();
    return records.map((r) => ({
      provider: r.provider,
      status: r.cooldownUntil && r.cooldownUntil > new Date()
        ? (r.lastFailureCategory ?? "UNKNOWN_FAILURE")
        : r.lastSuccessAt
          ? "OK"
          : "UNKNOWN",
      cooldownUntil: r.cooldownUntil,
      consecutiveFails: r.consecutiveFailures,
      lastTestedAt: r.lastFailureAt ?? r.lastSuccessAt ?? r.updatedAt,
    }));
  } catch (err) {
    logger.warn("[provider-health-store] Failed to fetch health summary:", { detail: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/**
 * Load DB-persisted provider health into the in-memory map.
 * Called once per process (guarded by healthLoaded flag) so cold starts
 * inherit active cooldowns recorded by prior instances.
 *
 * The inMemoryMap parameter is accepted for testing / direct sync use, but
 * the canonical path writes into lib/ai-provider-health.ts's internal state
 * via restoreProviderState().
 */
export async function loadProviderHealthIntoMemory(
  inMemoryMap?: Map<string, unknown>,
): Promise<void> {
  if (healthLoaded) return;
  healthLoaded = true;

  try {
    const snapshots = await prisma.providerHealthSnapshot.findMany();
    const now = Date.now();

    for (const snap of snapshots) {
      if (!ALL_PROVIDERS.includes(snap.provider as AiProviderName)) continue;

      const cooldownUntilMs = snap.cooldownUntil ? snap.cooldownUntil.getTime() : null;
      // Skip fully expired cooldowns with no recent failure activity
      if (cooldownUntilMs && cooldownUntilMs <= now && !snap.lastFailureAt) continue;

      restoreProviderState(snap.provider as AiProviderName, {
        lastSuccessAt: snap.lastSuccessAt ? snap.lastSuccessAt.getTime() : null,
        // The DB snapshot only persists the generic lastSuccessAt; the
        // per-tier verification timestamps (ping/generation/analysis) are
        // in-memory only, so they restore as null on a cold start.
        lastPingSucceededAt: null,
        lastGenerationSucceededAt: null,
        lastAnalysisSucceededAt: null,
        lastFailureAt: snap.lastFailureAt ? snap.lastFailureAt.getTime() : null,
        lastFailureCategory: (snap.lastFailureCategory as AiProviderFailureCategory | null) ?? null,
        lastFailureMessage: snap.lastSafeErrorMessage ?? null,
        consecutiveFailures: snap.consecutiveFailures,
        cooldownUntil: cooldownUntilMs,
      });

      // If caller passed an explicit map (for testing), also write into it
      if (inMemoryMap) {
        inMemoryMap.set(snap.provider, getProviderStateSnapshot(snap.provider as AiProviderName));
      }
    }
  } catch (err) {
    logger.warn("[provider-health-store] loadProviderHealthIntoMemory failed:", { detail: err instanceof Error ? err.message : String(err) });
  }
}

/** Reset the healthLoaded guard — test-only. */
export const __testing__ = {
  resetHealthLoadedFlag: () => { healthLoaded = false; },
};
