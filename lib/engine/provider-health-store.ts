// Provider health store — DB-backed persistence for cold-start recovery.
//
// This module provides a higher-level API over the ProviderHealthSnapshot table.
// It wraps lib/ai-provider-health-db.ts and lib/ai-provider-health.ts to give
// callers a single import point with the canonical markProviderFailed /
// markProviderOK / isProviderCoolingDown / getProviderHealthSummary API.

import { prisma } from "@/lib/prisma";
import {
  recordProviderFailure,
  recordProviderSuccess,
  recordProviderAnalysisSuccess,
  recordProviderPingSuccess,
  isProviderCooledDown,
  getProviderStateSnapshot,
  restoreProviderState,
  type AiProviderName,
  type AiProviderFailureCategory,
} from "@/lib/ai-provider-health";

// Cooldown seconds per failure class.
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

const ALL_PROVIDERS: AiProviderName[] = [
  "mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic",
];

let healthLoaded = false;

function redactError(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/sk-ant-[A-Za-z0-9-_=]{8,}/g, "[REDACTED]")
    .replace(/sk-or-[A-Za-z0-9-_=]{8,}/g, "[REDACTED]")
    .replace(/sk-[A-Za-z0-9-_]{8,}/g, "[REDACTED]")
    .replace(/gsk_[A-Za-z0-9-_]{8,}/g, "[REDACTED]")
    .replace(/dsk[-_][A-Za-z0-9-_]{8,}/g, "[REDACTED]")
    .replace(/AIza[A-Za-z0-9-_]{15,}/g, "[REDACTED]")
    .replace(/AQ[A-Za-z0-9-_]{20,}/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/authorization:\s*[A-Za-z0-9._\-+/=]+/gi, "authorization: [REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function toFailureCategory(failureClass: string): AiProviderFailureCategory {
  const map: Record<string, AiProviderFailureCategory> = {
    RATE_LIMIT: "RATE_LIMIT",
    QUOTA_EXHAUSTED: "RATE_LIMIT",
    AUTH: "AUTH",
    TIMEOUT: "TIMEOUT",
    MODEL_UNAVAILABLE: "MODEL_UNAVAILABLE",
    NETWORK: "NETWORK",
    MALFORMED_RESPONSE: "MALFORMED_RESPONSE",
    UNKNOWN: "UNKNOWN",
  };
  return map[failureClass] ?? "UNKNOWN";
}

export async function markProviderFailed(
  provider: string,
  failureClass: string,
  redactedError?: string,
): Promise<void> {
  const category = toFailureCategory(failureClass);
  const safeError = redactError(redactedError);
  recordProviderFailure(provider as AiProviderName, new Error(safeError || failureClass));

  const cooldownSeconds = COOLDOWN_SECONDS[failureClass] ?? COOLDOWN_SECONDS.UNKNOWN;
  const cooldownUntil = new Date(Date.now() + cooldownSeconds * 1_000);

  try {
    const existing = await prisma.providerHealthSnapshot.findUnique({ where: { provider } });
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
    console.warn("[provider-health-store] Failed to persist markProviderFailed:", err instanceof Error ? err.message : String(err));
  }
}

export async function markProviderPingOK(provider: string): Promise<void> {
  recordProviderPingSuccess(provider as AiProviderName);
  try {
    await prisma.providerHealthSnapshot.upsert({
      where: { provider },
      update: {
        lastPingSucceededAt: new Date(),
        consecutiveFailures: 0,
        cooldownUntil: null,
        lastFailureCategory: null,
        lastSafeErrorMessage: null,
      },
      create: {
        provider,
        lastPingSucceededAt: new Date(),
        consecutiveFailures: 0,
        cooldownUntil: null,
      },
    });
  } catch (err) {
    console.warn("[provider-health-store] Failed to persist markProviderPingOK:", err instanceof Error ? err.message : String(err));
  }
}

export async function markProviderAnalysisOK(provider: string): Promise<void> {
  recordProviderAnalysisSuccess(provider as AiProviderName);
  try {
    await prisma.providerHealthSnapshot.upsert({
      where: { provider },
      update: {
        lastAnalysisSucceededAt: new Date(),
        lastSuccessAt: new Date(),
        consecutiveFailures: 0,
        cooldownUntil: null,
        lastFailureCategory: null,
        lastSafeErrorMessage: null,
      },
      create: {
        provider,
        lastAnalysisSucceededAt: new Date(),
        lastSuccessAt: new Date(),
        consecutiveFailures: 0,
        cooldownUntil: null,
      },
    });
  } catch (err) {
    console.warn("[provider-health-store] Failed to persist markProviderAnalysisOK:", err instanceof Error ? err.message : String(err));
  }
}

export async function markProviderOK(provider: string): Promise<void> {
  recordProviderSuccess(provider as AiProviderName);
  try {
    await prisma.providerHealthSnapshot.upsert({
      where: { provider },
      update: {
        lastGenerationSucceededAt: new Date(),
        lastSuccessAt: new Date(),
        consecutiveFailures: 0,
        cooldownUntil: null,
        lastFailureCategory: null,
        lastSafeErrorMessage: null,
      },
      create: {
        provider,
        lastGenerationSucceededAt: new Date(),
        lastSuccessAt: new Date(),
        consecutiveFailures: 0,
        cooldownUntil: null,
      },
    });
  } catch (err) {
    console.warn("[provider-health-store] Failed to persist markProviderOK:", err instanceof Error ? err.message : String(err));
  }
}

export async function isProviderCoolingDown(provider: string): Promise<boolean> {
  if (isProviderCooledDown(provider as AiProviderName)) return true;
  try {
    const snap = await prisma.providerHealthSnapshot.findUnique({ where: { provider } });
    if (!snap || !snap.cooldownUntil) return false;
    return snap.cooldownUntil > new Date();
  } catch {
    return false;
  }
}

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
      lastTestedAt: r.lastFailureAt ?? r.lastSuccessAt ?? (r as any).lastPingSucceededAt ?? (r as any).lastAnalysisSucceededAt ?? (r as any).lastGenerationSucceededAt ?? r.updatedAt,
    }));
  } catch (err) {
    console.warn("[provider-health-store] Failed to fetch health summary:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

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
      if (cooldownUntilMs && cooldownUntilMs <= now && !snap.lastFailureAt) continue;

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

      if (inMemoryMap) {
        inMemoryMap.set(snap.provider, getProviderStateSnapshot(snap.provider as AiProviderName));
      }
    }
  } catch (err) {
    console.warn("[provider-health-store] loadProviderHealthIntoMemory failed:", err instanceof Error ? err.message : String(err));
  }
}

export const __testing__ = {
  resetHealthLoadedFlag: () => { healthLoaded = false; },
};
