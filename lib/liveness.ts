import { NextResponse } from "next/server";
import { prisma, prismaReady } from "./prisma";
import { checkAiProviderHealth } from "./ai-provider-health-check";
import { getStorageReadiness } from "./storage";
import { MAX_PROVIDER_ATTEMPTS_PER_REQUEST } from "./ai";
import { MAX_CANDIDATES_PER_MATCHER_BATCH, adaptiveBatchSize } from "./engine/ai-multi-perspective-matcher";
import { PRE_FILTER_LIMIT } from "./engine/main-engine-ai-rematch";

const CRITICAL_TABLES = [
  // Authentication path. Without these nobody can sign in, so their absence is
  // the most consequential thing this endpoint can report — yet none of them
  // were probed until a live deployment answered "healthy" while every login
  // returned 503.
  "User",
  "Session",
  "AuditLog",
  "RateLimitBucket",
  "PasswordResetToken",
  "SubmissionPlanState",
  "AiAnalyzeChunk",
  "AiJob",
] as const;

/**
 * Models whose full-scalar read is exercised as a schema-agreement probe.
 *
 * Table existence is not enough. A database can hold every table this app
 * needs and still reject every query, because Prisma selects each scalar the
 * schema declares and a database missing one column fails the whole read. That
 * is not hypothetical: after a DATABASE_URL was repointed at a database that
 * had the tables but not the latest migrations, /api/health reported
 * {"ok":true,"status":"healthy"} with all five probed tables true, while
 * POST /api/auth/login returned 503 on every attempt — a
 * PrismaClientKnownRequestError from `prisma.user.findUnique`, which is a
 * column the client expects and the database does not have.
 *
 * Listing columns here would drift the moment a migration adds one. Instead
 * each model is READ the way the application reads it, so the probe always
 * asks exactly what the current client asks.
 */
const SCHEMA_PROBE_MODELS = ["user", "session", "auditLog"] as const;

export type SchemaAgreement = {
  matches: boolean;
  failingModels: string[];
  /** Prisma error code (e.g. P2022 for a missing column), when one was given. */
  errorCode: string | null;
};

/**
 * Does the live database actually satisfy the Prisma client compiled into this
 * deployment?
 *
 * Each probe is a bounded read of one row. It touches no user data beyond
 * existence and returns nothing from the row itself.
 */
async function schemaAgreement(): Promise<SchemaAgreement> {
  const failingModels: string[] = [];
  let errorCode: string | null = null;
  try {
    await prismaReady;
  } catch {
    return { matches: false, failingModels: [...SCHEMA_PROBE_MODELS], errorCode: null };
  }
  for (const model of SCHEMA_PROBE_MODELS) {
    try {
      await (prisma as unknown as Record<string, { findFirst: (args: unknown) => Promise<unknown> }>)[model]
        .findFirst({ take: 1 });
    } catch (error) {
      failingModels.push(model);
      const code = (error as { code?: unknown }).code;
      if (!errorCode && typeof code === "string") errorCode = code;
    }
  }
  return { matches: failingModels.length === 0, failingModels, errorCode };
}

async function tableStatus(): Promise<Record<string, boolean>> {
  try {
    await prismaReady;
    const rows = await prisma.$queryRaw<Array<{ name: string; exists: boolean }>>`
      SELECT name, to_regclass('"' || name || '"') IS NOT NULL AS exists
      FROM (VALUES
        ('User'),
        ('Session'),
        ('AuditLog'),
        ('RateLimitBucket'),
        ('PasswordResetToken'),
        ('SubmissionPlanState'),
        ('AiAnalyzeChunk'),
        ('AiJob')
      ) AS t(name)
    `;
    return Object.fromEntries(rows.map((row) => [row.name, row.exists]));
  } catch {
    return Object.fromEntries(CRITICAL_TABLES.map((name) => [name, false]));
  }
}

/**
 * Everything the health check knows. Split out from `livenessResponse()` so the
 * PUBLIC endpoint and the ADMIN diagnostics view derive `ok`/`status`/HTTP code
 * from one implementation while exposing different amounts of detail.
 */
async function computeLivenessSnapshot() {
  const tables = await tableStatus();
  const allCriticalTablesExist = CRITICAL_TABLES.every((name) => tables[name] === true);
  // Asked separately from table existence, because the two fail differently:
  // a table can be present and still reject every query the client makes.
  const schema = await schemaAgreement();
  const aiHealth = checkAiProviderHealth();
  // getStorageReadiness() (lib/storage.ts) is the single canonical storage
  // policy resolver — provider, ready/durable/boundedFallback flags, and a
  // secret-free human-readable detail string. Previously this endpoint had
  // no storage awareness at all: Brand Assets and tender upload failures
  // (e.g. no Blob token configured and ALLOW_DB_FILE_STORAGE=false, so no
  // storage provider works) were invisible here even though /api/health is
  // what an external uptime monitor checks.
  const storageHealth = getStorageReadiness();

  // Healthy requires DB tables, at least one AI provider, AND ready file
  // storage. Any of the latter two missing makes the app "degraded" — it
  // can still serve pages but can't do AI analysis/generation, or can't
  // durably store uploads, respectively.
  // A database the client cannot query is not a degraded app, it is a stopped
  // one — sign-in fails outright — so schema disagreement counts with missing
  // tables, not with the optional subsystems below it.
  const databaseUsable = allCriticalTablesExist && schema.matches;
  // `aiHealth.healthy` now means "a provider has completed a real AI Analyze
  // extraction in this process", which a freshly-started serverless instance
  // cannot have done yet. Gating `ok` on it would make /api/health flap to
  // ok:false on every cold start of a perfectly working deployment — noise, not
  // truth. What `ok` needs is that the AI subsystem is not BROKEN, i.e. the
  // active chain has at least one provider that may be contacted. The stronger
  // verified-capability claim is carried separately in `aiRuntimeVerified` and
  // is what production readiness gates on.
  const aiUsable = aiHealth.state !== "unhealthy";
  const ok = databaseUsable && aiUsable && storageHealth.ready;
  const status = ok ? "healthy" : databaseUsable ? "degraded" : "unhealthy";

  // HTTP 200 when the DB is reachable (even if AI providers or durable
  // storage are not configured — the app is "degraded" but still serving
  // pages). HTTP 503 only when critical DB tables are missing (the app
  // cannot function). Previously, a deployment with valid DB tables but no
  // AI keys returned 503, causing external monitors and
  // `verify-production-health.mjs` to fail even though pages rendered fine.
  // The same reasoning now applies to storage: a broken Blob/DB-fallback
  // configuration degrades uploads, not the whole app.
  //
  // Schema disagreement joins missing tables on the 503 side for the same
  // reason: the deployment cannot serve a login, so a monitor must not see 200.
  const httpStatus = databaseUsable ? 200 : 503;

  return { tables, allCriticalTablesExist, schema, databaseUsable, aiHealth, aiUsable, storageHealth, ok, status, httpStatus };
}

/**
 * PUBLIC, UNAUTHENTICATED liveness/readiness.
 *
 * Carries only what real monitoring actually consumes, verified against every
 * caller in this repository:
 *   • `ok`                      — e2e/anonymous, e2e/tablet, production-smoke
 *   • `status`                  — verify-deployment, verify-production-health
 *   • `release`                 — verify-deployment, verify-production-health,
 *                                 verify-production-artifacts, production-smoke
 *   • `tables[...]`             — verify-deployment, verify-production-health,
 *                                 production-smoke (critical-table readiness)
 *   • `deploymentId`            — verify-production-health (reporting)
 *   • HTTP 200 / 503            — every monitor
 *
 * Deliberately NOT public any more: the AI provider names and canonical order,
 * storage provider internals, engine tuning constants (attempt budget, matcher
 * batch size, pre-filter limit, soft deadline) and the internal deployment URL.
 * No caller in this repository read any of them, and together they described
 * the system's internal topology to anonymous callers. They are still available
 * to authenticated ADMINs via `detailedLivenessPayload()`.
 */
export async function livenessResponse() {
  const snapshot = await computeLivenessSnapshot();

  return NextResponse.json(
    {
      ok: snapshot.ok,
      status: snapshot.status,
      release: process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || "unknown",
      tables: snapshot.tables,
      // Named plainly so the reason is actionable without a log dive: when this
      // is false the database is behind the deployed code and the fix is to run
      // the pending migrations, not to wait and retry.
      schemaMatchesDeployedCode: snapshot.schema.matches,
      timestamp: new Date().toISOString(),
    },
    { status: snapshot.httpStatus, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Full diagnostic payload for AUTHENTICATED ADMIN callers only.
 *
 * Never return this from an unauthenticated route. It still contains no keys or
 * secrets — only effective non-secret configuration — but it does describe
 * internal topology (provider order, storage provider, tuning limits) that
 * anonymous callers have no need for.
 */
export async function detailedLivenessPayload() {
  const snapshot = await computeLivenessSnapshot();
  const { aiHealth, storageHealth } = snapshot;

  return {
    ok: snapshot.ok,
    status: snapshot.status,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
    release: process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || "unknown",
    deploymentUrl: process.env.VERCEL_URL || "unknown",
    tables: snapshot.tables,
    schema: snapshot.schema,
    aiProviders: aiHealth,
    // The strong claim, kept separate from `ok`: a provider has completed a real
    // AI Analyze extraction on this instance. Production readiness gates on
    // this; `ok` only requires that the chain is not broken.
    aiRuntimeVerified: aiHealth.state === "healthy",
    aiState: aiHealth.state,
    storage: storageHealth,
    // Effective non-secret runtime configuration, so source, tests and the
    // deployed effective settings can be reconciled by an admin.
    effectiveConfig: {
      providerAttemptBudget: MAX_PROVIDER_ATTEMPTS_PER_REQUEST,
      matcherBatchSize: MAX_CANDIDATES_PER_MATCHER_BATCH,
      adaptiveBatchSizeAvailable: true,
      preFilterLimit: PRE_FILTER_LIMIT,
      engineInvocationSoftDeadlineMs: 40_000,
      providerOrder: aiHealth.eligibleProviders ?? [],
      activeChain: aiHealth.activeChain,
    },
    timestamp: new Date().toISOString(),
  };
}
