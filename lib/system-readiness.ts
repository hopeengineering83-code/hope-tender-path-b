import { prisma, prismaReady } from "./prisma";
import { isEmailDeliveryConfigured } from "./email";
import { getStorageReadiness } from "./storage";
import {
  CANONICAL_AI_PROVIDER_ORDER,
  CANONICAL_AI_PROVIDER_DISPLAY_NAMES,
  isProviderConfigured,
  providerDisplayName,
} from "./ai-provider-registry";

export type ReadinessSeverity = "OK" | "WARNING" | "CRITICAL";

export type ReadinessCheck = {
  key: string;
  title: string;
  severity: ReadinessSeverity;
  detail: string;
  requiredForProduction: boolean;
};

export type SystemReadiness = {
  productionReady: boolean;
  checks: ReadinessCheck[];
};

function has(value: string | undefined | null): boolean {
  return Boolean(value && value.trim().length > 0);
}

// Required provider order — generated from the authoritative registry so it
// never drifts from the single source of truth.
export const REQUIRED_PROVIDER_ORDER = CANONICAL_AI_PROVIDER_DISPLAY_NAMES;

function configuredAiProviders(): string[] {
  return CANONICAL_AI_PROVIDER_ORDER
    .filter((p) => isProviderConfigured(p))
    .map((p) => providerDisplayName(p));
}

async function databaseChecks(): Promise<ReadinessCheck[]> {
  try {
    await prismaReady;
    await prisma.$queryRawUnsafe("SELECT 1");

    const functionRows = await prisma.$queryRawUnsafe<Array<{ proname: string }>>(
      `SELECT proname FROM pg_proc WHERE proname IN ('resolve_tender_requirement_source_file', 'guard_canonical_requirement_set_delete', 'refresh_submission_plan_state')`,
    );
    const functions = new Set(functionRows.map((row) => row.proname));
    const missingFunctions = [
      "resolve_tender_requirement_source_file",
      "guard_canonical_requirement_set_delete",
      "refresh_submission_plan_state",
    ].filter((name) => !functions.has(name));

    const tableRows = await prisma.$queryRawUnsafe<Array<{ submissionPlanState: string | null; resetToken: string | null; rateLimit: string | null }>>(
      `SELECT
        to_regclass('"SubmissionPlanState"')::text AS "submissionPlanState",
        to_regclass('"PasswordResetToken"')::text AS "resetToken",
        to_regclass('"RateLimitBucket"')::text AS "rateLimit"`,
    );
    const tables = tableRows[0];
    const missingTables = [
      !tables?.submissionPlanState ? "SubmissionPlanState" : null,
      !tables?.resetToken ? "PasswordResetToken" : null,
      !tables?.rateLimit ? "RateLimitBucket" : null,
    ].filter(Boolean) as string[];

    return [
      {
        key: "database",
        title: "PostgreSQL connectivity",
        severity: "OK",
        requiredForProduction: true,
        detail: "Database connection and Prisma client are operational.",
      },
      {
        key: "database_guards",
        title: "Required database guards",
        severity: missingFunctions.length === 0 && missingTables.length === 0 ? "OK" : "CRITICAL",
        requiredForProduction: true,
        detail: missingFunctions.length === 0 && missingTables.length === 0
          ? "Required functions and security tables are installed."
          : `Missing migration objects: ${[...missingFunctions, ...missingTables].join(", ")}. Run prisma migrate deploy.`,
      },
    ];
  } catch (error) {
    return [{
      key: "database",
      title: "PostgreSQL connectivity",
      severity: "CRITICAL",
      requiredForProduction: true,
      detail: `Database or migration readiness failed (${error instanceof Error ? error.constructor.name : "UnknownError"}).`,
    }];
  }
}

export async function getSystemReadiness(): Promise<SystemReadiness> {
  const checks = await databaseChecks();
  const configuredProviders = configuredAiProviders();
  // getStorageReadiness() (lib/storage.ts) is the single canonical policy
  // resolver for storage readiness -- it already accounts for
  // isDatabaseStorageAllowed()'s default-allow-when-unset-and-no-token
  // behavior. This check previously re-derived its own, subtly different
  // condition (requiring ALLOW_DB_FILE_STORAGE === "true" exactly), which
  // reported CRITICAL for a configuration lib/storage.ts itself treats as
  // ready (unset ALLOW_DB_FILE_STORAGE + no Blob token, the default
  // bounded-fallback-allowed state) -- an operator dashboard false alarm
  // for storage that was actually working. Delegating avoids the two
  // modules disagreeing about the same fact.
  const storageReadiness = getStorageReadiness();
  const production = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL_ENV);
  const strongSessionSecret = (process.env.SESSION_SECRET ?? process.env.AUTH_SECRET ?? "").length >= 32;
  const smtpConfigured = isEmailDeliveryConfigured();

  checks.push(
    {
      key: "session_secret",
      title: "Session signing secret",
      severity: strongSessionSecret ? "OK" : "CRITICAL",
      requiredForProduction: true,
      detail: strongSessionSecret ? "A sufficiently long session secret is configured." : "Configure SESSION_SECRET or AUTH_SECRET with at least 32 characters.",
    },
    {
      key: "file_storage",
      title: "Durable private file storage",
      severity: !production || storageReadiness.ready ? "OK" : "CRITICAL",
      requiredForProduction: true,
      detail: `Storage provider: ${storageReadiness.provider}. ${storageReadiness.detail}`,
    },
    {
      key: "ai_providers",
      title: "AI provider chain",
      severity: configuredProviders.length > 0 ? "OK" : "CRITICAL",
      requiredForProduction: true,
      detail: configuredProviders.length > 0
        ? `Configured providers in policy order: ${configuredProviders.join(" → ")}.`
        : `Configure at least one provider. Policy order: ${REQUIRED_PROVIDER_ORDER.join(" → ")}.`,
    },
    {
      key: "email",
      title: "Password reset email delivery",
      severity: !production || smtpConfigured ? "OK" : "CRITICAL",
      requiredForProduction: true,
      detail: smtpConfigured ? "SMTP delivery is configured." : "SMTP_HOST, SMTP_USER, SMTP_PASS and EMAIL_FROM are required for production password reset.",
    },
    {
      key: "worker_auth",
      title: "Background worker automated-call authentication",
      // VERIFIED BEHAVIOR: /api/ai-jobs/run-next does NOT become publicly
      // unauthenticated when worker/cron secrets are absent. It falls back
      // to requireRole("ADMIN", "PROPOSAL_MANAGER") and scopes claims to
      // that user. So missing secrets are an OPERATIONAL limitation
      // (automated global callers — cron, external orchestrators — cannot
      // invoke the worker without a user session), not a security hole.
      //
      // This product's target workflow is upload-and-continue: later Engine
      // and proposal jobs must keep moving after the browser closes. The
      // endpoint remains secure without a secret, but the promised background
      // automation does not. Treat missing automated-caller authentication as
      // a production-readiness blocker rather than silently degrading to a
      // manual, browser-dependent workflow.
      severity: has(process.env.AI_JOBS_WORKER_SECRET) || has(process.env.CRON_SECRET)
        ? "OK"
        : !production
          ? "WARNING"
          : "CRITICAL",
      requiredForProduction: true,
      detail: has(process.env.AI_JOBS_WORKER_SECRET) || has(process.env.CRON_SECRET)
        ? "Automated worker authentication is configured (AI_JOBS_WORKER_SECRET or CRON_SECRET)."
        : "No automated worker secret is configured. User-scoped execution remains secure, but queued Engine and proposal continuations cannot reliably progress after the browser closes. Configure AI_JOBS_WORKER_SECRET or CRON_SECRET and the queue-drain scheduler.",
    },
  );

  return {
    productionReady: checks.every((check) => !check.requiredForProduction || check.severity === "OK"),
    checks,
  };
}
