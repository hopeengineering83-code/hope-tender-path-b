/**
 * Per-user AI quota enforcement (audit H-6).
 *
 * AiUsageRecord is observational — it logs usage but does not enforce any
 * limit. Without this module, a compromised admin session could burn through
 * thousands of provider calls per hour. This module adds a configurable
 * daily quota checked at AI entry points.
 *
 * Config (env vars):
 *   AI_DAILY_QUOTA_ADMIN           default 500  calls/day
 *   AI_DAILY_QUOTA_PROPOSAL_MANAGER default 100 calls/day
 *   AI_DAILY_QUOTA_REVIEWER         default 20  calls/day
 *   AI_DAILY_QUOTA_VIEWER           default 0   calls/day (blocked)
 *   AI_DAILY_QUOTA_DISABLED         "true" to bypass (for tests/dev only)
 *
 * The quota is counted as the number of AiUsageRecord rows created for the
 * user in the last 24 hours. This is conservative — it counts both successful
 * and failed calls — so a user whose calls all fail still consumes quota.
 * That's intentional: it prevents an attacker from burning provider quota
 * with deliberately-malformed inputs that fail after the provider call.
 */

import { prisma, prismaReady } from "./prisma";
import { logger } from "./observability";

export type AiQuotaDecision = {
  allowed: boolean;
  used: number;
  limit: number;
  resetAtMs: number;
  reason?: string;
};

const DEFAULT_QUOTAS: Record<string, number> = {
  ADMIN: 500,
  PROPOSAL_MANAGER: 100,
  REVIEWER: 20,
  VIEWER: 0,
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return fallback;
  return n;
}

function envFlag(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

export function getQuotaForRole(role: string): number {
  switch (role) {
    case "ADMIN":
      return envInt("AI_DAILY_QUOTA_ADMIN", DEFAULT_QUOTAS.ADMIN);
    case "PROPOSAL_MANAGER":
      return envInt("AI_DAILY_QUOTA_PROPOSAL_MANAGER", DEFAULT_QUOTAS.PROPOSAL_MANAGER);
    case "REVIEWER":
      return envInt("AI_DAILY_QUOTA_REVIEWER", DEFAULT_QUOTAS.REVIEWER);
    case "VIEWER":
      return envInt("AI_DAILY_QUOTA_VIEWER", DEFAULT_QUOTAS.VIEWER);
    default:
      return DEFAULT_QUOTAS.VIEWER; // unknown role = most restrictive
  }
}

/**
 * Check whether the user may make another AI call. Returns a decision object
 * that the caller can use to either proceed or return a 429.
 *
 * Counts the number of AiUsageRecord rows for this user in the last 24h.
 * This is an approximate count — it includes both successful and failed
 * calls, which is intentional (see module comment).
 */
export async function checkAiQuota(userId: string, role: string): Promise<AiQuotaDecision> {
  // Bypass for tests/dev. NEVER set in production — it disables the quota
  // entirely, allowing unlimited AI calls.
  if (envFlag("AI_DAILY_QUOTA_DISABLED")) {
    return { allowed: true, used: 0, limit: -1, resetAtMs: Date.now() + ONE_DAY_MS };
  }

  const limit = getQuotaForRole(role);
  if (limit === 0) {
    return {
      allowed: false,
      used: 0,
      limit: 0,
      resetAtMs: Date.now() + ONE_DAY_MS,
      reason: "AI access is not available for this role.",
    };
  }

  try {
    await prismaReady;
    const since = new Date(Date.now() - ONE_DAY_MS);
    const used = await prisma.aiUsageRecord.count({
      where: { userId, createdAt: { gt: since } },
    });
    const allowed = used < limit;
    return {
      allowed,
      used,
      limit,
      resetAtMs: Date.now() + ONE_DAY_MS,
      reason: allowed ? undefined : `Daily AI quota exhausted (${used}/${limit}).`,
    };
  } catch (e) {
    // If the DB is unreachable, fail OPEN for AI quota — a DB outage should
    // not block legitimate AI work. The rate-limit module (lib/rate-limit.ts)
    // already fails closed for auth-adjacent paths; AI quota is a cost-control
    // layer, not a security layer.
    logger.warn("[ai-quota] checkAiQuota failed (failing open):", {
      errorClass: e instanceof Error ? e.constructor.name : "UnknownError",
    });
    return { allowed: true, used: 0, limit: -1, resetAtMs: Date.now() + ONE_DAY_MS };
  }
}
