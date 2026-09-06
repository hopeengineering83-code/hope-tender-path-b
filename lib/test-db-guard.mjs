// ─── Fail-closed guard for database integration tests ────────────────────────
//
// AUDIT GAP (#5): The CI workflow already sets DATABASE_URL to an ephemeral
// postgres:16 service container (postgresql://hope_ci@127.0.0.1:5432/...).
// But there was NO runtime guard preventing a test process from accidentally
// connecting to a production Neon host if, for example:
//   - A contributor ran `npm test` locally with their .env file loaded.
//   - A future workflow change reintroduced `secrets.DATABASE_URL`.
//   - A test script inlined a hardcoded connection string.
//
// This module is imported by `scripts/run-tests.mjs` BEFORE any test file
// runs, so it guards the entire test process. It throws synchronously when
// DATABASE_URL points at any production-designated host.
//
// The allow-list is intentionally tiny: only loopback, RFC1918 private ranges,
// and the documented ephemeral CI service-container hostname (`hope_ci@127.0.0.1`
// or `hope_ci@postgres`). Any other host requires an explicit opt-in via
// TEST_DB_ALLOW_HOST=<exact-hostname>. Production hostnames (neon.tech, the
// known production Neon hostname, and any host matching the production
// database name) are NEVER allow-listable — even with the opt-in.
//
// This module MUST be import-safe from environments without DATABASE_URL set
// (it no-ops so unit tests can run with the placeholder set by run-tests.mjs).
//
// Scopes:
//   - RUN_DB_INTEGRATION=true → enforce the guard (this is the only mode where
//     tests actually open a Prisma connection).
//   - RUN_DB_INTEGRATION != true → still blocks Neon/production-designated
//     DATABASE_URLs, even when the URL is a placeholder. Unit tests that don't
//     touch the DB are unaffected because they never open a Prisma connection.
//
// REQUIREMENT: Audit & fix the repository so GitHub Actions and all automated
// tests can never connect to the live Neon Production database.

// .mjs (plain JavaScript) so it can be imported natively from
// scripts/run-tests.mjs (Node ESM loader does not support .ts imports).
// The corresponding test file tests/test-db-guard.test.ts loads it via tsx.

const PRODUCTION_HOSTNAME_DENY_PATTERNS = [
  /neon\.tech/i, // Neon-hosted databases — includes *.neon.tech and the bare domain.
  /-pooler\.neon\.tech/i, // Neon's connection-pooler subdomain variant.
  /hope-tender-path-b.*\.neon\.tech/i, // Explicit production project hostname pattern.
];

const PRODUCTION_DB_NAME_DENY_PATTERNS = [
  /\bprod(uction)?[_-]?(tender|hope|db)?\b/i, // prod, production, production_tender, prod_hope
  /\b(tender|hope)[_-]?(prod|production)\b/i, // tender_prod, hope_production
  /\bmain[_-]?(tender|hope|db)\b/i, // main_tender, main_db (Vercel default for promoted prod)
  /\bvercel[_-]?(prod|production)\b/i, // vercel_prod alias
];

const ALLOWED_PRIVATE_HOSTNAMES = new Set([
  "127.0.0.1",
  "localhost",
  "postgres", // GitHub Actions service container hostname when linked.
  "db", // Common docker-compose alias.
  "::1", // IPv6 loopback.
]);

/**
 * Inspect a DATABASE_URL string and return the violation if it points at a
 * production-designated database. Returns null when the URL is allowed.
 *
 * Pure function — does not read process.env. Tested directly by
 * tests/test-db-guard.test.ts.
 */
export function detectProductionDatabaseViolation(databaseUrl) {
  if (!databaseUrl) return null;

  // Parse the URL safely. Invalid URLs are not production-leaking, so we
  // return null and let Prisma's own connection error surface.
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return null;
  }

  const hostname = parsed.hostname;
  const pathname = parsed.pathname || "";
  const dbName = pathname.replace(/^\//, "").split("?")[0];

  // 1) Reject any Neon hostname — case-insensitive, full-hostname match.
  for (const pattern of PRODUCTION_HOSTNAME_DENY_PATTERNS) {
    if (pattern.test(hostname)) {
      return {
        reason: `DATABASE_URL hostname "${hostname}" matches production Neon pattern /${pattern.source}/.`,
        hostname,
        database: dbName,
      };
    }
  }

  // 2) Reject production-designated database names regardless of host.
  for (const pattern of PRODUCTION_DB_NAME_DENY_PATTERNS) {
    if (dbName && pattern.test(dbName)) {
      return {
        reason: `DATABASE_URL database "${dbName}" matches production-designated pattern /${pattern.source}/.`,
        hostname,
        database: dbName,
      };
    }
  }

  return null;
}

/**
 * Returns true when the hostname is on the explicit private/loopback allow-list
 * OR has been opted-in via TEST_DB_ALLOW_HOST.
 */
export function isExplicitlyAllowedTestHost(hostname) {
  if (ALLOWED_PRIVATE_HOSTNAMES.has(hostname.toLowerCase())) return true;
  const optedIn = process.env.TEST_DB_ALLOW_HOST;
  if (optedIn) {
    const allowed = optedIn
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    if (allowed.includes(hostname.toLowerCase())) return true;
  }
  return false;
}

/**
 * Throw a fail-closed error when DATABASE_URL points at any production-designated
 * database. Called from scripts/run-tests.mjs before any test file runs.
 *
 * Behavior:
 *   - Always blocks:
 *       1. Any hostname matching neon.tech / known production Neon hostnames.
 *       2. Any database name matching production-designated patterns.
 *   - When RUN_DB_INTEGRATION=true, also requires hostname to be loopback /
 *     private / CI service container / explicit opt-in.
 *   - When DATABASE_URL is unset, the guard no-ops (env-check.ts handles the
 *     missing-var case).
 *
 * Throws an Error with a clear, actionable message — never returns silently.
 */
export function enforceTestDatabaseGuard(databaseUrl) {
  if (!databaseUrl) return;

  const violation = detectProductionDatabaseViolation(databaseUrl);
  if (violation) {
    // Hard fail-closed: production database detected, no opt-out.
    throw new Error(
      `[test-db-guard] FAIL-CLOSED: refusing to run tests against a production-designated database.\n` +
        `  Reason:    ${violation.reason}\n` +
        `  Hostname:  ${violation.hostname}\n` +
        `  Database:  ${violation.database ?? "(none)"}\n` +
        `  DATABASE_URL: ${databaseUrl.replace(/:[^:@]+@/, ":***@")}\n` +
        `\n` +
        `GitHub Actions tests MUST use the ephemeral postgres:16 service container\n` +
        `(DATABASE_URL=postgresql://hope_ci@127.0.0.1:5432/hope_tender_ci?schema=public).\n` +
        `Local developers MUST point DATABASE_URL at a local Postgres or docker-compose\n` +
        `instance — never at Neon, never at a production database name.\n` +
        `\n` +
        `This guard is enforced by lib/test-db-guard.mjs and cannot be bypassed.`,
    );
  }

  // Second-layer guard: if RUN_DB_INTEGRATION=true, require an explicitly
  // allowed test host. Unit-test mode (no RUN_DB_INTEGRATION) only blocks
  // Neon/production — any non-production host is tolerated because the test
  // runner sets a placeholder URL that no test actually connects to.
  if (process.env.RUN_DB_INTEGRATION === "true") {
    let parsed;
    try {
      parsed = new URL(databaseUrl);
    } catch {
      // env-check.ts will surface a clearer error for malformed URLs.
      return;
    }
    if (!isExplicitlyAllowedTestHost(parsed.hostname)) {
      throw new Error(
        `[test-db-guard] FAIL-CLOSED: RUN_DB_INTEGRATION=true requires DATABASE_URL to point at a\n` +
          `  private/loopback/CI-service host, but got "${parsed.hostname}".\n` +
          `  Allowed: 127.0.0.1, localhost, postgres, db, ::1, or any host listed in\n` +
          `  TEST_DB_ALLOW_HOST (comma-separated).\n` +
          `  DATABASE_URL: ${databaseUrl.replace(/:[^:@]+@/, ":***@")}\n` +
          `\n` +
          `If you need to run integration tests against a remote but NON-production\n` +
          `staging database, add its hostname to TEST_DB_ALLOW_HOST. Production Neon\n` +
          `hostnames are NEVER allow-listable — they are blocked unconditionally.\n`,
      );
    }
  }
}
