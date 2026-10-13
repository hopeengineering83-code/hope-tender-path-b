import { createHash } from "node:crypto";

/**
 * Which database is this deployment actually talking to?
 *
 * That question had no safe answer. A deployment carries the DATABASE_URL it
 * was built with, so changing the project setting leaves every existing
 * deployment on the previous database until it is rebuilt — and /api/health
 * answered "healthy" for both, identically. Two deployments of the same commit,
 * one on each database, were indistinguishable from outside, which is exactly
 * the confusion that makes someone accept stale runtime evidence as current.
 *
 * The only way anyone could previously tell them apart was to read the
 * connection string, which must never be printed, logged, screenshotted or
 * committed.
 *
 * This returns a one-way fingerprint of the host and database NAME only. The
 * user, the password and the query string are removed before hashing and never
 * reach the digest, so the value cannot leak a credential even if it is pasted
 * into a public issue. It is truncated because it only has to distinguish
 * databases, not identify them: the owner can confirm which endpoint it means
 * by hashing their own, and nobody else can work backwards from 48 bits to a
 * random Neon endpoint id.
 *
 * Returns null when no URL is configured, so a missing setting reads as
 * "unknown" rather than as a real fingerprint of nothing.
 */
export function databaseFingerprint(url: string | undefined = process.env.DATABASE_URL): string | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;

  let identity: string;
  try {
    const parsed = new URL(raw);
    // Host and database name only. Nothing else is read, so nothing else can
    // be hashed by accident if the URL gains new parameters.
    const database = parsed.pathname.replace(/^\/+/, "");
    identity = `${parsed.host}/${database}`;
  } catch {
    // An unparseable value must not be hashed raw — that would put whatever it
    // contains, credentials included, through the digest of a published field.
    return "unparseable";
  }

  if (!identity || identity === "/") return null;
  return createHash("sha256").update(identity).digest("hex").slice(0, 12);
}
