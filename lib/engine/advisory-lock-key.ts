import { createHash } from "node:crypto";

/**
 * Return a deterministic signed 64-bit PostgreSQL advisory-lock key.
 * NUL separators prevent ambiguous concatenation across identity dimensions.
 */
export function computeAdvisoryLockKey(parts: readonly string[]): bigint {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\0");
  }
  return hash.digest().readBigInt64BE(0);
}
