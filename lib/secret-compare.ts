import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compare a presented secret with the configured one in constant time. A plain
 * `===` returns at the first differing character, so response time leaks how
 * much of a guess was right. Both sides are hashed first, which makes the
 * lengths equal and the comparison independent of where they differ. A missing
 * or empty value never matches.
 */
export function secretMatches(presented: string | null | undefined, expected: string | null | undefined): boolean {
  if (!presented || !expected) return false;
  const a = createHash("sha256").update(presented, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}
