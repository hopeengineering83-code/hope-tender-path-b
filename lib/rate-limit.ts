/**
 * In-process token-bucket rate limiter.
 * Works on Vercel Edge/Node runtimes without Redis.
 * Buckets are per-key (userId or IP) and reset after `windowMs`.
 *
 * For multi-instance Vercel deployments each serverless instance has its own
 * in-memory map, so limits are per-instance. For strict global limits, swap
 * the map for a Vercel KV (Redis) backend — the interface is identical.
 */

type Bucket = { tokens: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export interface RateLimitConfig {
  /** Max requests allowed in the window */
  limit: number;
  /** Window length in milliseconds */
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

// Periodically purge expired buckets to prevent memory growth.
// Only runs in non-edge (Node) environments. We .unref() the timer so it
// does not keep the Node event loop alive (which would prevent the test
// runner / cron worker from exiting cleanly).
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

// ─── Preset configs ───────────────────────────────────────────────────────────

/** Expensive AI routes: 20 calls per minute per user */
export const AI_RATE_LIMIT: RateLimitConfig = { limit: 20, windowMs: 60_000 };

/** Standard API reads: 300 per minute per user */
export const API_RATE_LIMIT: RateLimitConfig = { limit: 300, windowMs: 60_000 };

/** Mutating workflow routes: 30 calls per minute per user */
export const MUTATION_RATE_LIMIT: RateLimitConfig = { limit: 30, windowMs: 60_000 };

/** Auth routes: 10 per minute per IP */
export const AUTH_RATE_LIMIT: RateLimitConfig = { limit: 10, windowMs: 60_000 };

/** Bulk upload: 5 per minute per user */
export const UPLOAD_RATE_LIMIT: RateLimitConfig = { limit: 5, windowMs: 60_000 };
