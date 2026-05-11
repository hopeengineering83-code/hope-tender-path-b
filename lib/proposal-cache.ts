const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days
const MAX_ENTRIES = 500;

interface CacheEntry {
  proposal: string;
  createdAt: number;
  fallback: boolean;
}

const cache = new Map<string, CacheEntry>();

function inMemoryCacheEnabled(): boolean {
  // Serverless instances are not durable and can also serve stale proposals
  // after knowledge-review changes because cache keys are built from stable
  // entity IDs. Disable by default on Vercel unless the operator explicitly
  // opts in for development or controlled deployments.
  if (process.env.ENABLE_IN_MEMORY_PROPOSAL_CACHE === "true") return true;
  if (process.env.DISABLE_IN_MEMORY_PROPOSAL_CACHE === "true") return false;
  if (process.env.VERCEL || process.env.NOW_REGION) return false;
  return process.env.NODE_ENV !== "production";
}

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
  if (!inMemoryCacheEnabled()) return null;
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
  if (!inMemoryCacheEnabled()) return;
  evictStale();
  if (cache.size >= MAX_ENTRIES) evictOldest();
  cache.set(key, { proposal, createdAt: Date.now(), fallback });
}

export function invalidateProposalCache(tenderId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${tenderId}|`)) cache.delete(key);
  }
}
