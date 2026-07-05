const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days
const MAX_ENTRIES = 500;

interface CacheEntry {
  proposal: string;
  createdAt: number;
  fallback: boolean;
}

const cache = new Map<string, CacheEntry>();

function evictStale(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.createdAt > CACHE_TTL_MS) cache.delete(key);
  }
}

function evictOldest(): void {
  const sorted = [...cache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
  const toRemove = sorted.slice(0, Math.floor(MAX_ENTRIES / 4));
  for (const [key] of toRemove) cache.delete(key);
}

export function buildProposalCacheKey(
  tenderId: string,
  expertIds: string[],
  projectIds: string[],
  mode: string
): string {
  const experts = [...expertIds].sort().join(",");
  const projects = [...projectIds].sort().join(",");
  return `${tenderId}|${experts}|${projects}|${mode}`;
}

export function getCachedProposal(key: string): { proposal: string; fallback: boolean } | null {
  evictStale();
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return { proposal: entry.proposal, fallback: entry.fallback };
}

export function setCachedProposal(key: string, proposal: string, fallback: boolean): void {
  evictStale();
  if (cache.size >= MAX_ENTRIES) evictOldest();
  cache.set(key, { proposal, createdAt: Date.now(), fallback });
}

export function invalidateProposalCache(tenderId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${tenderId}|`)) cache.delete(key);
  }
}
