import { prisma, prismaReady } from "./prisma";
import { getStorageReadiness } from "./storage";

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

export const REQUIRED_PROVIDER_ORDER = [
  "Mistral",
  "Groq",
  "OpenRouter",
  "Gemini",
  "OpenAI",
  "Together",
  "DeepSeek",
  "Claude/Anthropic",
] as const;

function configuredAiProviders(): string[] {
  const providers: string[] = [];
  if (has(process.env.MISTRAL_API_KEY)) providers.push("Mistral");
  if (has(process.env.GROQ_API_KEY)) providers.push("Groq");
  if (has(process.env.OPENROUTER_API_KEY)) providers.push("OpenRouter");
  if (has(process.env.GEMINI_API_KEY)) providers.push("Gemini");
  if (has(process.env.OPENAI_API_KEY)) providers.push("OpenAI");
  if (has(process.env.TOGETHER_API_KEY)) providers.push("Together");
  if (has(process.env.DEEPSEEK_API_KEY)) providers.push("DeepSeek");
  if (has(process.env.ANTHROPIC_API_KEY)) providers.push("Claude/Anthropic");
  return providers;
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

    const tableRows = await prisma.$queryRawUnsafe<Array<{
      submissionPlanState: string | null;
      resetToken: string | null;
      rateLimit: string | null;
      aiJob: string | null;
      tenderFile: string | null;
      documentReview: string | null;
    }>>(
      `SELECT
        to_regclass('"SubmissionPlanState"')::text AS "submissionPlanState",
        to_regclass('"PasswordResetToken"')::text AS "resetToken",
        to_regclass('"RateLimitBucket"')::text AS "rateLimit",
        to_regclass('"AiJob"')::text AS "aiJob",
        to_regclass('"TenderFile"')::text AS "tenderFile",
        to_regclass('"DocumentReview"')::text AS "documentReview"`,
    );
    const tables = tableRows[0];
    const missingTables = [
      !tables?.submissionPlanState ? "SubmissionPlanState" : null,
      !tables?.resetToken ? "PasswordResetToken" : null,
      !tables?.rateLimit ? "RateLimitBucket" : null,
      !tables?.aiJob ? "AiJob" : null,
      !tables?.tenderFile ? "TenderFile" : null,
      !tables?.documentReview ? "DocumentReview" : null,
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
        title: "Required database schema and guards",
        severity: missingFunctions.length === 0 && missingTables.length === 0 ? "OK" : "CRITICAL",
        requiredForProduction: true,
        detail: missingFunctions.length === 0 && missingTables.length === 0
          ? "Required workflow tables, security tables and database functions are installed."
          : `Missing migration objects: ${[...missingFunctions, ...missingTables].join(", ")}. Run prisma migrate deploy and the critical schema check.`,
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
  const storage = getStorageReadiness();
  const production = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL_ENV);
  const strongSessionSecret = (process.env.SESSION_SECRET ?? process.env.AUTH_SECRET ?? "").length >= 32;
  const smtpConfigured = has(process.env.SMTP_HOST) && has(process.env.SMTP_USER) && has(process.env.SMTP_PASS) && has(process.env.EMAIL_FROM);

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
      severity: !production || storage.ready ? "OK" : "CRITICAL",
      requiredForProduction: true,
      detail: storage.detail,
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
      title: "Background worker authentication",
      severity: has(process.env.AI_JOBS_WORKER_SECRET) || has(process.env.CRON_SECRET) ? "OK" : "WARNING",
      requiredForProduction: false,
      detail: has(process.env.AI_JOBS_WORKER_SECRET) || has(process.env.CRON_SECRET)
        ? "At least one worker authentication secret is configured."
        : "No worker or cron secret is configured; only user-scoped workers can run.",
    },
  );

  return {
    productionReady: checks.every((check) => !check.requiredForProduction || check.severity === "OK"),
    checks,
  };
}
