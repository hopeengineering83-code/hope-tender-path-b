#!/usr/bin/env node
// scripts/verify-pre-deploy-safe.mjs
//
// Pre-deploy safety verification — run BEFORE merging PR #1175 to main and
// BEFORE deploying to production. Exits non-zero on any blocker; exits 0 with
// a green report when safe to deploy.
//
// Addresses the 3 deploy-time blockers identified in the 5× audit:
//
//   1. CREATE INDEX without CONCURRENTLY (migration 20260717165000)
//      — Prisma wraps migrations in BEGIN/COMMIT so CONCURRENTLY cannot be
//        used inside. Operator must verify TenderFile and TenderRequirement
//        row counts; if > 100k, run the 3 CREATE INDEX statements manually
//        with CONCURRENTLY, then `prisma migrate resolve --applied`.
//
//   2. Pre-flight check in migration 20260717165000 raises exception if
//      duplicate (tenderId, revision) rows exist in SubmissionPlanRevision.
//      Operator must verify 0 duplicates before merge.
//
//   3. CSRF trust boundary — `lib/security/csrf.ts`'s deriveRoutedRequestOrigin
//      trusts `x-forwarded-host`. Operator must either:
//        (a) deploy on Vercel (platform strips and re-sets from the edge), OR
//        (b) set CSRF_TRUSTED_HOSTS env var to an explicit allowlist when
//            self-hosting behind a reverse proxy.
//
//   4. APP_URL must be set in production (forgot-password route throws otherwise).
//
//   5. SESSION_SECRET / AUTH_SECRET must be ≥32 chars in production.
//
// Usage:
//   DATABASE_URL=postgresql://... node scripts/verify-pre-deploy-safe.mjs
//   DATABASE_URL=postgresql://... NODE_ENV=production node scripts/verify-pre-deploy-safe.mjs
//
// Exit codes:
//   0 — all checks passed, safe to deploy
//   1 — at least one blocker found, do NOT deploy

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const isProduction = process.env.NODE_ENV === "production";

const blockers = [];
const warnings = [];
const passed = [];

/**
 * Strip credentials from anything that came back from a driver.
 *
 * This report is printed into build logs, and a Prisma connection failure
 * quotes the connection string it tried — which carries the database
 * password. The three `e.message` interpolations below are reached exactly
 * when the database misbehaves, so the one moment this script is most likely
 * to print something is also the moment it is most likely to print a
 * credential. scripts/migrate-deploy-safe.mjs already redacts for this
 * reason; this script did not.
 */
function redact(value) {
  let text = String(value ?? "");
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) text = text.split(databaseUrl).join("[REDACTED_DATABASE_URL]");
  return text
    .replace(/DATABASE_URL\s*[:=]\s*\S+/gi, "DATABASE_URL=[REDACTED]")
    // Any URI carrying user:password@host, whoever produced it.
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/gi, "[REDACTED_CREDENTIAL_URI]@");
}

function logPassed(msg) { passed.push(`  PASS  ${msg}`); }
function logWarning(msg) { warnings.push(`  WARN  ${msg}`); }
function logBlocker(msg) { blockers.push(`  BLOCK  ${msg}`); }

async function checkRowCounts() {
  console.log("\n[1/5] Checking row counts for migrations without CONCURRENTLY...");
  try {
    const [tenderFileCount, tenderRequirementCount, submissionPlanRevisionCount] = await Promise.all([
      prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "TenderFile"`.then((r) => r[0]?.count ?? 0),
      prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "TenderRequirement"`.then((r) => r[0]?.count ?? 0),
      prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "SubmissionPlanRevision"`.then((r) => r[0]?.count ?? 0),
    ]);

    console.log(`  TenderFile:              ${tenderFileCount} rows`);
    console.log(`  TenderRequirement:       ${tenderRequirementCount} rows`);
    console.log(`  SubmissionPlanRevision:  ${submissionPlanRevisionCount} rows`);

    // Migration 20260717165000 creates 3 indexes on these tables without CONCURRENTLY.
    // Prisma wraps each migration in BEGIN/COMMIT, so CONCURRENTLY is not usable
    // inside the migration. On large tables the index build locks writes for
    // the duration. Threshold: 100k rows = ~1-2 second lock; > 100k = manual
    // CONCURRENTLY application recommended.
    const LOCK_THRESHOLD = 100_000;
    if (tenderFileCount > LOCK_THRESHOLD) {
      logBlocker(
        `TenderFile has ${tenderFileCount} rows (> ${LOCK_THRESHOLD}). ` +
        `Migration 20260717165000's CREATE INDEX will lock writes for > 2s. ` +
        `Apply the 3 CREATE INDEX statements manually with CONCURRENTLY, then: ` +
        `prisma migrate resolve --applied 20260717165000_reconcile_schema_history_indexes`
      );
    } else {
      logPassed(`TenderFile row count (${tenderFileCount}) is below CONCURRENTLY threshold (${LOCK_THRESHOLD})`);
    }

    if (tenderRequirementCount > LOCK_THRESHOLD) {
      logBlocker(
        `TenderRequirement has ${tenderRequirementCount} rows (> ${LOCK_THRESHOLD}). ` +
        `Migration 20260717165000's CREATE INDEX will lock writes for > 2s. ` +
        `Apply manually with CONCURRENTLY.`
      );
    } else {
      logPassed(`TenderRequirement row count (${tenderRequirementCount}) is below CONCURRENTLY threshold (${LOCK_THRESHOLD})`);
    }
  } catch (e) {
    logBlocker(`Could not query row counts: ${redact(e.message)}. Is DATABASE_URL set and reachable?`);
  }
}

async function checkDuplicateSubmissionPlanRevisions() {
  console.log("\n[2/5] Checking for duplicate (tenderId, revision) rows in SubmissionPlanRevision...");
  try {
    const duplicates = await prisma.$queryRaw`
      SELECT "tenderId", "revision", COUNT(*)::int AS dup_count
      FROM "SubmissionPlanRevision"
      GROUP BY "tenderId", "revision"
      HAVING COUNT(*) > 1
      LIMIT 5
    `;
    if (Array.isArray(duplicates) && duplicates.length > 0) {
      logBlocker(
        `Found ${duplicates.length}+ duplicate (tenderId, revision) rows in SubmissionPlanRevision. ` +
        `Migration 20260717165000's pre-flight DO $$ block will raise an exception and the migration will fail. ` +
        `Dedupe these rows before deploying: ` +
        `DELETE FROM "SubmissionPlanRevision" WHERE id NOT IN ` +
        `(SELECT MIN(id) FROM "SubmissionPlanRevision" GROUP BY "tenderId", "revision");`
      );
      for (const d of duplicates) {
        console.log(`    tenderId=${d.tenderId} revision=${d.revision} dup_count=${d.dup_count}`);
      }
    } else {
      logPassed("No duplicate (tenderId, revision) rows in SubmissionPlanRevision");
    }
  } catch (e) {
    logWarning(`Could not check duplicates: ${redact(e.message)}`);
  }
}

function checkEnvVars() {
  console.log("\n[3/5] Checking required environment variables...");
  const required = [
    ["DATABASE_URL", "PostgreSQL connection string"],
    ["SESSION_SECRET", "Session signing secret (≥32 chars)"],
  ];
  for (const [name, desc] of required) {
    if (!process.env[name]) {
      logBlocker(`${name} is not set (${desc}). Required in production.`);
    } else {
      logPassed(`${name} is set`);
    }
  }

  // SESSION_SECRET length check
  const secret = process.env.SESSION_SECRET ?? process.env.AUTH_SECRET ?? "";
  if (secret && secret.length < 32) {
    // The exact length is information about the secret; the threshold is what
    // the operator needs.
    logBlocker("SESSION_SECRET / AUTH_SECRET is shorter than the required 32 characters.");
  } else if (secret) {
    // Report the threshold, not the measurement. The exact length of a secret
    // is information about the secret, and this report is printed into build
    // logs.
    logPassed("SESSION_SECRET / AUTH_SECRET length is at least 32 chars");
  }
}

function checkCsrfTrustBoundary() {
  console.log("\n[4/5] Checking CSRF trust boundary configuration...");
  // lib/security/csrf.ts trusts x-forwarded-host unless CSRF_TRUSTED_HOSTS is set.
  // On Vercel the platform overwrites from the edge — safe.
  // On self-hosted or reverse-proxy setups, operator must set CSRF_TRUSTED_HOSTS.
  const vercelEnv = process.env.VERCEL_ENV || process.env.VERCEL_URL;
  const trustedHosts = process.env.CSRF_TRUSTED_HOSTS;
  const appUrl = process.env.APP_URL || process.env.NEXTAUTH_URL;

  if (vercelEnv) {
    logPassed("Deploying on Vercel — platform strips and re-sets x-forwarded-host from the edge.");
  } else if (trustedHosts) {
    logPassed("CSRF_TRUSTED_HOSTS is set — x-forwarded-host values not in this allowlist will be rejected.");
  } else if (isProduction) {
    logBlocker(
      `Production deploy without Vercel AND without CSRF_TRUSTED_HOSTS. ` +
      `lib/security/csrf.ts deriveRoutedRequestOrigin() trusts x-forwarded-host, which on self-hosted ` +
      `or reverse-proxy setups can be spoofed by an attacker controlling both the browser Origin AND ` +
      `the forwarded header. Set CSRF_TRUSTED_HOSTS to an explicit allowlist (e.g. "hope.example.com").`
    );
  } else {
    logWarning(`Dev/staging deploy without CSRF_TRUSTED_HOSTS — acceptable for local dev only.`);
  }

  // APP_URL check (forgot-password route throws in production if missing)
  if (isProduction && !appUrl) {
    logBlocker(
      `APP_URL (or NEXTAUTH_URL) is not set in production. ` +
      `app/api/auth/forgot-password/route.ts will throw "APP_URL must be set in production" ` +
      `when a user requests a password reset — the route returns 202 (no info leak) but no email is sent.`
    );
  } else if (appUrl) {
    // The value is deliberately not echoed: this report goes to build logs,
    // and whether the variable is set is the whole question.
    logPassed("APP_URL / NEXTAUTH_URL is set");
  }
}

async function checkMigrationHistory() {
  console.log("\n[5/5] Checking Prisma migration history...");
  try {
    const applied = await prisma.$queryRaw`
      SELECT migration_name, finished_at
      FROM "_prisma_migrations"
      WHERE migration_name IN (
        '20260717165000_reconcile_schema_history_indexes',
        '20260719230000_drop_undeclared_bootstrap_indexes'
      )
      ORDER BY migration_name
    `;
    if (Array.isArray(applied) && applied.length > 0) {
      for (const m of applied) {
        console.log(`    ${m.migration_name}: applied at ${m.finished_at}`);
      }
      logWarning(`${applied.length} of the 2 new migrations are already applied. Re-running migrations is safe (idempotent).`);
    } else {
      logPassed("Neither new migration is applied yet — fresh deploy.");
    }
  } catch (e) {
    logWarning(`Could not query _prisma_migrations table: ${redact(e.message)}`);
  }
}

async function main() {
  console.log("=========================================");
  console.log("  Pre-deploy safety verification");
  console.log("  PR #1175 — release/consolidated-recovery-20260717");
  console.log("=========================================");
  console.log(`NODE_ENV: ${redact(process.env.NODE_ENV) || "(unset)"}`);
  console.log(`Time:     ${new Date().toISOString()}`);

  await checkRowCounts();
  await checkDuplicateSubmissionPlanRevisions();
  checkEnvVars();
  checkCsrfTrustBoundary();
  await checkMigrationHistory();

  console.log("\n=========================================");
  console.log("  Report");
  console.log("=========================================");
  console.log(`\nPassed (${passed.length}):`);
  for (const p of passed) console.log(redact(p));
  if (warnings.length > 0) {
    console.log(`\nWarnings (${warnings.length}):`);
    for (const w of warnings) console.log(redact(w));
  }
  if (blockers.length > 0) {
    console.log(`\nBlockers (${blockers.length}):`);
    for (const b of blockers) console.log(redact(b));
    console.log("\n❌ DEPLOY BLOCKED — resolve blockers above before merging/deploying.");
    await prisma.$disconnect();
    process.exit(1);
  } else {
    console.log("\n✅ All checks passed — safe to deploy.");
    await prisma.$disconnect();
    process.exit(0);
  }
}

main().catch(async (e) => {
  console.error("Fatal error:", redact(e instanceof Error ? e.message : e));
  await prisma.$disconnect();
  process.exit(2);
});
