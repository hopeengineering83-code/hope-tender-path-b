import { AI_PROVIDER_API_KEY_ENVS, ZAI_FORBIDDEN_MODEL_OVERRIDES } from "./ai-provider-catalog.cjs";
import { logger } from "./observability";
/**
 * Startup environment validation.
 * Imported at the top of lib/prisma.ts so it runs on every cold start.
 * Fails LOUDLY — throws at module load time so the process crashes with
 * a clear message rather than silently degrading.
 *
 * ARCHITECTURE: at least one AI provider key is required in production:
 *   - ZAI_API_KEY / CEREBRAS_API_KEY / MISTRAL_API_KEY / GROQ_API_KEY /
 *     OPENROUTER_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY / TOGETHER_API_KEY /
 *     DEEPSEEK_API_KEY / ANTHROPIC_API_KEY. The canonical chain (single source of
 *     truth: lib/ai-provider-registry.ts) is Z.ai GLM → Cerebras → Mistral → Groq
 *     → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic/Claude, with
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

// Canonical provider key order comes from the shared provider catalog so
// startup/runtime validation cannot drift from build-time validation or the
// registry fallback order.
const AI_PROVIDER_KEY_DESCRIPTIONS: Record<string, string> = {
  ZAI_API_KEY: "Z.ai GLM API key. First-tier provider in the canonical chain (general OpenAI-compatible endpoint).",
  CEREBRAS_API_KEY: "Cerebras API key. Second-tier provider (OpenAI-compatible, uses max_completion_tokens).",
  MISTRAL_API_KEY: "Mistral API key. Third-tier proposal/validation provider and analysis fallback.",
  GROQ_API_KEY: "Groq API key. Fourth-tier proposal fallback provider.",
  OPENROUTER_API_KEY: "OpenRouter API key. Fifth-tier aggregator — requires an explicit ':free' model.",
  GEMINI_API_KEY:
    "Google Gemini API key (AIza...). Sixth-tier provider in the canonical chain. " +
    "Without an AI key, all imported records are REGEX_DRAFT and BLOCKED from final proposal generation.",
  OPENAI_API_KEY: "OpenAI API key (sk-...). Seventh-tier provider in the canonical chain.",
  TOGETHER_API_KEY: "Together API key. Eighth-tier proposal fallback provider.",
  DEEPSEEK_API_KEY: "DeepSeek API key. Ninth-tier fallback via OpenAI-compatible endpoint.",
  ANTHROPIC_API_KEY: "Anthropic Claude API key (sk-ant-...). Last-resort, emergency-only provider; Claude must remain last in the chain.",
};

const AI_PROVIDER_KEYS: Array<{ name: string; description: string }> = AI_PROVIDER_API_KEY_ENVS.map((name) => ({
  name,
  description: AI_PROVIDER_KEY_DESCRIPTIONS[name] ?? `${name} AI provider key.`,
}));

const ZAI_MODEL_ENVS = ["ZAI_PROPOSAL_MODEL", "ZAI_ANALYSIS_MODEL", "ZAI_FAST_MODEL"] as const;
const FORBIDDEN_ZAI_MODELS = new Set<string>(ZAI_FORBIDDEN_MODEL_OVERRIDES);

function invalidZaiModelOverride(env: Record<string, string | undefined>): string | null {
  for (const name of ZAI_MODEL_ENVS) {
    const model = env[name]?.trim();
    if (model && FORBIDDEN_ZAI_MODELS.has(model)) {
      return `${name}=${model} is forbidden; use glm-4-flash.`;
    }
  }
  return null;
}

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

  // At least one valid AI provider key. Z.ai is not treated as configured when
  // an explicitly forbidden model override is present, matching the registry
  // request-time configured check.
  const zaiModelError = invalidZaiModelOverride(env);
  if (zaiModelError) {
    if (isProd || (isVercelPreview && strictPreview)) errors.push(zaiModelError);
    else warnings.push(zaiModelError);
  }

  const hasAnyAIKey = AI_PROVIDER_KEYS.some(({ name }) => {
    if (name !== "ZAI_API_KEY") return Boolean(env[name]);
    return Boolean(env[name]) && !zaiModelError;
  });
  if (!hasAnyAIKey) {
    const message =
      `At least one AI provider key is required (${AI_PROVIDER_KEYS.map((k) => k.name).join(", ")}). ` +
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
  const zaiModelError = invalidZaiModelOverride(process.env as Record<string, string | undefined>);
  return AI_PROVIDER_KEYS.some(({ name }) => {
    if (name !== "ZAI_API_KEY") return Boolean(process.env[name]);
    return Boolean(process.env[name]) && !zaiModelError;
  });
}

// Alias used in diagnostics and other routes
export function isAIEnabled(): boolean {
  return isAIConfigured();
}
