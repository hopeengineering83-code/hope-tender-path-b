// Cache for latest partial AI job info on tender dashboard.
// Avoids N+1 queries when multiple users load the same tender.
// TTL: 10 seconds (dashboard refresh granularity)

const CACHE_TTL_MS = 10 * 1_000;
const MAX_ENTRIES = 2000; // ~2k concurrent tenders * 1 user each

interface CacheEntry {
  jobId: string;
  completedChunks: number;
  totalChunks: number;
  cachedAt: number;
}

const cache = new Map<string, CacheEntry>();

function evictStale(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.cachedAt > CACHE_TTL_MS) cache.delete(key);
  }
}

function evictOldest(): void {
  const sorted = [...cache.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt);
  const toRemove = sorted.slice(0, Math.floor(MAX_ENTRIES / 4));
  for (const [key] of toRemove) cache.delete(key);
}

export function buildDashboardCacheKey(tenderId: string, userId: string): string {
  return `${tenderId}|${userId}`;
}

export function getCachedPartialJobInfo(
  tenderId: string,
  userId: string
): { jobId: string; completedChunks: number; totalChunks: number } | null {
  evictStale();
  const key = buildDashboardCacheKey(tenderId, userId);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return { jobId: entry.jobId, completedChunks: entry.completedChunks, totalChunks: entry.totalChunks };
}

export function setCachedPartialJobInfo(
  tenderId: string,
  userId: string,
  jobId: string,
  completedChunks: number,
  totalChunks: number
): void {
  evictStale();
  if (cache.size >= MAX_ENTRIES) evictOldest();
  const key = buildDashboardCacheKey(tenderId, userId);
  cache.set(key, { jobId, completedChunks, totalChunks, cachedAt: Date.now() });
}

export function invalidateDashboardCache(tenderId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${tenderId}|`)) cache.delete(key);
  }
}
