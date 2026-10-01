// Which connection `prisma migrate deploy` should use.
//
// Extracted from scripts/migrate-deploy-safe.mjs so it can be tested directly:
// that script performs the migration as a side effect of being loaded, so the
// rule could not otherwise be exercised without running a deployment.
//
// See the caller for the full reasoning. In short: migrations take a
// SESSION-scoped advisory lock, and a transaction pooler answers consecutive
// statements from different backends, so the lock can never be observed and
// Prisma fails with P1002. The application runtime is unaffected — pooling is
// right for it.

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ url: string, source: string, pooled: boolean }}
 */
export function resolveMigrationDatabaseUrl(env = process.env) {
  const explicit = (env.DIRECT_URL || env.MIGRATE_DATABASE_URL || "").trim();
  if (explicit) {
    return { url: explicit, source: "DIRECT_URL/MIGRATE_DATABASE_URL", pooled: false };
  }

  const configured = env.DATABASE_URL ?? "";
  try {
    const parsed = new URL(configured);
    if (parsed.hostname.includes("-pooler.")) {
      // Neon's convention: the direct host is the pooled host without the
      // marker. Only the hostname is touched — credentials, database, port and
      // every query parameter (sslmode included) are carried across unchanged.
      parsed.hostname = parsed.hostname.replace("-pooler.", ".");
      return {
        url: parsed.toString(),
        source: "derived from DATABASE_URL (pooler marker removed)",
        pooled: false,
      };
    }
  } catch {
    // A connection string this runtime cannot parse is left exactly as
    // configured. Guessing at a malformed URL is worse than using it as given.
  }
  return { url: configured, source: "DATABASE_URL (not pooled)", pooled: false };
}
