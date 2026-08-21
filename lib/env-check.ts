import { logger } from "./observability";
import {
  CANONICAL_AI_PROVIDER_ORDER,
  PAID_ACCESS_PROVIDERS,
  CONDITIONAL_FREE_PROVIDERS,
  PROVIDER_API_KEY_ENV,
  automaticProviderOrder,
} from "./ai-provider-catalog.cjs";
import { providerAutomaticEligibility } from "./ai-provider-registry";
/**
 * Startup environment validation.
 * Imported at the top of lib/prisma.ts so it runs on every cold start.
 * Fails LOUDLY — throws at module load time so the process crashes with
 * a clear message rather than silently degrading.
 *
 * ARCHITECTURE: at least one normally configured provider is required in
 * production. Providers participate in the single canonical fallback order;
 * model identifiers are used exactly as configured.
 *
 * Without an automatic provider key:
 *   - Every imported expert/project is classified as REGEX_DRAFT
 *   - REGEX_DRAFT records are BLOCKED from use in final proposal generation
 *   - A deployment with no AI key can never complete the proposal workflow
 *
 * Gap 5 — preview deployments warn (relaxed) unless STRICT_PREVIEW_ENV_CHECK=true;
 * development never throws on AI-key absence, it warns. Production always throws.
 */

const REQUIRED_VARS: Array<{ name: string; description: string }> = [
  { name: "DATABASE_URL", description: "PostgreSQL connection string (postgresql://...)" },
  { name: "SESSION_SECRET", description: "At least 32-character random string for HMAC session signing" },
];

// The ten known provider keys, in canonical order and with their access class.
// Order and key names are DERIVED from the catalog — the rank text that used to
// be written into each description here ("Rank 1 automatic provider", …) was a
// copy that went stale the moment the order changed.
const AI_PROVIDER_KEYS: Array<{ name: string; description: string }> = CANONICAL_AI_PROVIDER_ORDER.map(
  (provider, index) => {
    const envName = PROVIDER_API_KEY_ENV[provider];
    const paid = PAID_ACCESS_PROVIDERS.includes(provider);
    const conditional = CONDITIONAL_FREE_PROVIDERS.includes(provider);
    const role = paid
      ? "requires PAID access — excluded from automatic use while zero-paid mode is on"
      : conditional
        ? "free ONLY with an explicitly configured ':free' model"
        : "free-tier provider in the automatic chain";
    return { name: envName, description: `Rank ${index + 1}: ${role}.` };
  },
);

const INSECURE_DEFAULTS: Record<string, string> = {
  SESSION_SECRET: "hope-tender-path-built-in-secret-v1",
};

/**
 * Banned SESSION_SECRET defaults — must match scripts/check-env.mjs so build
 * and runtime fail together rather than letting a built deployment crash on
 * its first request.
 */
const BANNED_SESSION_SECRETS = new Set<string>([
  "hope-tender-path-built-in-secret-v1",
  "replace-this-with-a-64-character-random-hex-string",
  "changeme",
  "secret",
]);

export type EnvCheckResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

function envFlag(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/**
 * Pure variant of checkEnv() that reads from an explicit env map. Used by the
 * env-policy tests so we can validate every combination without mutating
 * process.env. The default callsite (no argument) reads from process.env.
 */
export function evaluateEnv(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): EnvCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const nodeEnv = env.NODE_ENV ?? "";
  const vercelEnv = env.VERCEL_ENV ?? "";
  const isVercel = env.VERCEL === "1";
  const isVercelPreview = isVercel && vercelEnv === "preview";
  const strictPreview = envFlag(env.STRICT_PREVIEW_ENV_CHECK);
  const isProd = nodeEnv === "production" && (!isVercel || vercelEnv === "production");

  // Always-required: DATABASE_URL + SESSION_SECRET.
  for (const { name, description } of REQUIRED_VARS) {
    const value = env[name];
    if (!value) {
      if (isProd) errors.push(`${name}: ${description}`);
      else if (isVercelPreview && !strictPreview) warnings.push(`${name}: missing (preview relaxed mode).`);
      else if (isVercelPreview) errors.push(`${name}: ${description}`);
      else warnings.push(`${name}: missing (development).`);
    } else if (INSECURE_DEFAULTS[name] && value === INSECURE_DEFAULTS[name]) {
      warnings.push(`${name}: insecure default value detected. Set a real secret.`);
    }
  }

  // DATABASE_URL format check (always applies when present).
  const dbUrl = env.DATABASE_URL ?? "";
  if (dbUrl && !dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://")) {
    errors.push(
      `DATABASE_URL must start with postgresql:// or postgres://. Got: "${dbUrl.slice(0, 30)}...". SQLite is not supported.`,
    );
  }

  // SESSION_SECRET strength check.
  const secret = env.SESSION_SECRET ?? "";
  if (secret) {
    if (secret.length < 32) {
      if (isProd) errors.push(`SESSION_SECRET must be at least 32 characters in production. Got ${secret.length}.`);
      else warnings.push(`SESSION_SECRET is only ${secret.length} characters. Use at least 32 random characters.`);
    }
    if (BANNED_SESSION_SECRETS.has(secret)) {
      if (isProd) errors.push("SESSION_SECRET is a banned placeholder value. Generate a real secret: openssl rand -hex 32");
      else warnings.push("SESSION_SECRET is a banned placeholder value (allowed in dev only).");
    }
  }

  const processEnv = env as NodeJS.ProcessEnv;
  const configuredProviders = automaticProviderOrder(processEnv).filter(
    (provider) => providerAutomaticEligibility(provider, processEnv).eligible,
  );
  if (configuredProviders.length < 1) {
    const message =
      "At least one normally configured AI provider key/model is required. " +
      "A provider with a missing effective model does not satisfy readiness.";
    if (isProd) errors.push(message);
    else if (isVercelPreview && strictPreview) errors.push(message);
    else warnings.push(message);
  }

  // SENTRY_DSN is optional but strongly recommended for production.
  // Without it, errors are only logged to stdout/Vercel logs — no alerting.
  if (isProd && !env.SENTRY_DSN) {
    warnings.push("SENTRY_DSN is not set. Errors will only appear in stdout/Vercel logs with no alerting or grouping. Set SENTRY_DSN to enable error reporting.");
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function checkEnv(): void {
  const { errors, warnings } = evaluateEnv();

  if (warnings.length > 0) {
    logger.warn("\n⚠  ENVIRONMENT WARNINGS:");
    for (const w of warnings) logger.warn(`  ⚠ ${w}`);
    logger.warn("");
  }

  if (errors.length > 0) {
    const lines = [
      "",
      "═══════════════════════════════════════════════════════════",
      "  FATAL: Required environment variables are not configured.",
      "  The application cannot start without these variables.",
      "═══════════════════════════════════════════════════════════",
      "",
      "Missing / invalid variables:",
      ...errors.map((e) => `  ✗ ${e}`),
      "",
      "Set these in your .env.local (development) or Vercel dashboard (production).",
      "See .env.example for the expected format.",
      "═══════════════════════════════════════════════════════════",
      "",
    ];
    logger.error(lines.join("\n"));
    throw new Error(`Environment validation failed: ${errors.join("; ")}`);
  }
}

export function isAIConfigured(): boolean {
  // "Configured" means a provider the app is ALLOWED TO CONTACT has a key.
  //
  // This used to be true if ANY of the ten keys was present. On a zero-paid
  // deployment holding only OPENAI_API_KEY that answer was actively wrong: the
  // app would report AI as enabled while the automatic chain had nothing it
  // could call, so every AI feature failed with a message about providers being
  // exhausted rather than about none being usable.
  //
  // Reads env at call time, never at module load, so a changed environment is
  // reflected without a rebuild.
  return AUTOMATIC_PROVIDER_KEY_ENVS().some((name) => {
    const value = process.env[name];
    return Boolean(value && value.trim().length > 0);
  });
}

/**
 * Env var names for the providers the automatic chain may currently contact.
 * A function, not a constant, because the active chain depends on
 * AI_ZERO_PAID_MODE, which is read from the environment.
 */
function AUTOMATIC_PROVIDER_KEY_ENVS(): string[] {
  return automaticProviderOrder(process.env).map((p) => PROVIDER_API_KEY_ENV[p]);
}

/**
 * True when a key is present for a provider that is NOT reachable — the state
 * where an operator is looking at configured keys and getting no AI at all.
 */
export function hasOnlyUnreachableProviderKeys(): boolean {
  if (isAIConfigured()) return false;
  return CANONICAL_AI_PROVIDER_ORDER.some((p) => {
    const value = process.env[PROVIDER_API_KEY_ENV[p]];
    return Boolean(value && value.trim().length > 0);
  });
}

// Alias used in diagnostics and other routes
export function isAIEnabled(): boolean {
  return isAIConfigured();
}
