// DB-backed persistence layer for provider health state.
import { prisma } from "./prisma";
import { CANONICAL_AI_PROVIDER_ORDER } from "./ai-provider-policy";
import {
  type AiProviderName,
  type AiProviderFailureCategory,
  restoreProviderState,
  getProviderStateSnapshot,
} from "./ai-provider-health";

const ALL_PROVIDERS = CANONICAL_AI_PROVIDER_ORDER;

let restoredAt: number | null = null;
const RESTORE_ONCE_MS = 5 * 60_000;

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
      if (cooldownUntilMs && cooldownUntilMs <= now) continue;
      if (snap.lastFailureAt && now - snap.lastFailureAt.getTime() > 10 * 60_000 && !cooldownUntilMs) continue;

      if (!(ALL_PROVIDERS as readonly string[]).includes(snap.provider)) continue;

      restoreProviderState(snap.provider as AiProviderName, {
        lastSuccessAt: snap.lastSuccessAt ? snap.lastSuccessAt.getTime() : null,
        lastPingSucceededAt: (snap as any).lastPingSucceededAt ? (snap as any).lastPingSucceededAt.getTime() : null,
        lastGenerationSucceededAt: (snap as any).lastGenerationSucceededAt ? (snap as any).lastGenerationSucceededAt.getTime() : null,
        lastAnalysisSucceededAt: (snap as any).lastAnalysisSucceededAt ? (snap as any).lastAnalysisSucceededAt.getTime() : null,
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
      const s = getProviderStateSnapshot(provider); if (!s) continue;
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
