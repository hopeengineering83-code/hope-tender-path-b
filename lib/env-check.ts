/**
 * Startup environment validation.
 * Imported at the top of lib/prisma.ts so it runs on every cold start.
 * Fails LOUDLY — throws at module load time so the process crashes with
 * a clear message rather than silently degrading.
 *
 * ARCHITECTURE: at least one AI provider key is required in production:
 *   - OPENAI_API_KEY / GEMINI_API_KEY / MISTRAL_API_KEY / DEEPSEEK_API_KEY /
 *     GROQ_API_KEY / TOGETHER_API_KEY / OPENROUTER_API_KEY / ANTHROPIC_API_KEY. The current default proposal
 *     chain is Z.ai GLM → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic / Claude, with
 *     Claude last so Anthropic rate limits do not block the app.
 *
 * Without EITHER key:
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

const AI_PROVIDER_KEYS: Array<{ name: string; description: string }> = [
  {
    name: "ANTHROPIC_API_KEY",
    description: "Anthropic Claude API key (sk-ant-...). Last-resort provider; Claude must remain last in the default chain.",
  },
  {
    name: "GEMINI_API_KEY",
    description:
      "Google Gemini API key (AIza...). First-tier provider in the canonical chain for analysis, extraction, proposal, validation, and fast use cases. " +
      "Without an AI key, all imported records are REGEX_DRAFT and BLOCKED from final proposal generation.",
  },
  {
    name: "OPENAI_API_KEY",
    description: "OpenAI API key (sk-...). Second-tier provider in the canonical chain after Gemini.",
  },
  {
    name: "MISTRAL_API_KEY",
    description: "Mistral API key. Third-tier proposal/validation provider and analysis fallback.",
  },
  {
    name: "DEEPSEEK_API_KEY",
    description: "DeepSeek API key. Fourth-tier fallback for proposal generation via OpenAI-compatible endpoint.",
  },
  {
    name: "GROQ_API_KEY",
    description: "Groq API key. Sixth-tier proposal fallback provider.",
  },
  {
    name: "TOGETHER_API_KEY",
    description: "Together API key. Fourth-tier proposal fallback provider.",
  },
  {
    name: "OPENROUTER_API_KEY",
    description: "OpenRouter API key. Seventh-tier proposal fallback aggregator.",
  },
];

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

  // At least one AI provider key.
  const hasAnyAIKey = AI_PROVIDER_KEYS.some(({ name }) => Boolean(env[name]));
  if (!hasAnyAIKey) {
    const message =
      "At least one AI provider key is required (OPENAI_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY, DEEPSEEK_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY, OPENROUTER_API_KEY, or ANTHROPIC_API_KEY). " +
      "Without any AI key, all imported records are REGEX_DRAFT and BLOCKED from final proposal generation.";
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
    console.warn("\n⚠  ENVIRONMENT WARNINGS:");
    for (const w of warnings) console.warn(`  ⚠ ${w}`);
    console.warn("");
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
    console.error(lines.join("\n"));
    throw new Error(`Environment validation failed: ${errors.join("; ")}`);
  }
}

export function isAIConfigured(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.MISTRAL_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.GROQ_API_KEY ||
    process.env.TOGETHER_API_KEY ||
    process.env.OPENROUTER_API_KEY,
  );
}

// Alias used in diagnostics and other routes
export function isAIEnabled(): boolean {
  return isAIConfigured();
}
