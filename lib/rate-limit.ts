import { createHash } from "crypto";
import { prisma, prismaReady } from "./prisma";

type Bucket = { tokens: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(key: string, cfg: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { tokens: cfg.limit, resetAt: now + cfg.windowMs };
    buckets.set(key, bucket);
  }
  if (bucket.tokens > 0) {
    bucket.tokens -= 1;
    return { allowed: true, remaining: bucket.tokens, resetAt: bucket.resetAt };
  }
  return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export async function rateLimitPersistent(key: string, cfg: RateLimitConfig): Promise<RateLimitResult> {
  const now = new Date();
  const nextReset = new Date(now.getTime() + cfg.windowMs);
  try {
    await prismaReady;
    const rows = await prisma.$queryRawUnsafe<Array<{ count: number; resetAt: Date }>>(
      `INSERT INTO "RateLimitBucket" ("keyHash", "count", "resetAt", "createdAt", "updatedAt")
       VALUES ($1, 1, $2, NOW(), NOW())
       ON CONFLICT ("keyHash") DO UPDATE SET
         "count" = CASE WHEN "RateLimitBucket"."resetAt" <= NOW() THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
         "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= NOW() THEN $2 ELSE "RateLimitBucket"."resetAt" END,
         "updatedAt" = NOW()
       RETURNING "count", "resetAt"`,
      hashKey(key),
      nextReset,
    );
    const row = rows[0];
    if (!row) throw new Error("rate limiter did not return a bucket");
    const count = Number(row.count);
    const resetAt = new Date(row.resetAt).getTime();
    return { allowed: count <= cfg.limit, remaining: Math.max(0, cfg.limit - count), resetAt };
  } catch (error) {
    // Gracefully degrade on any DB error so uploads aren't blocked by transient
    // connectivity issues, cold-start timeouts, or missing-table errors (42P01).
    // Only rethrow permission errors (42501) which indicate a config problem
    // that needs operator attention, not a transient degradation.
    const msg = error instanceof Error ? error.message : String(error);
    const isPermissionError = msg.includes("42501") || msg.includes("permission denied");
    if (isPermissionError) throw error;
    if (process.env.NODE_ENV === "production") {
      console.warn("[rate-limit] DB error, falling back to in-memory:", msg.slice(0, 120));
    }
    return rateLimit(key, cfg);
  }
}

if (typeof setInterval !== "undefined") {
  const handle = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
  }, 60_000);
  if (typeof (handle as { unref?: () => void }).unref === "function") {
    (handle as { unref: () => void }).unref();
  }
}

export const AI_RATE_LIMIT: RateLimitConfig = { limit: 20, windowMs: 60_000 };
export const API_RATE_LIMIT: RateLimitConfig = { limit: 300, windowMs: 60_000 };
export const MUTATION_RATE_LIMIT: RateLimitConfig = { limit: 30, windowMs: 60_000 };
export const AUTH_RATE_LIMIT: RateLimitConfig = { limit: 10, windowMs: 60_000 };
export const PASSWORD_RESET_RATE_LIMIT: RateLimitConfig = { limit: 5, windowMs: 15 * 60_000 };
export const UPLOAD_RATE_LIMIT: RateLimitConfig = { limit: 5, windowMs: 60_000 };
