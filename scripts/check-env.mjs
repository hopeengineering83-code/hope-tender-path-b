/**
 * scripts/check-env.mjs
 *
 * Build-time environment validation.
 * Run BEFORE `next build` so that Vercel deployments fail at the build step
 * with a clear error message rather than deploying a broken runtime.
 *
 * Usage (in package.json build script):
 *   "build": "node scripts/check-env.mjs && prisma generate && next build"
 */

// The canonical provider ORDER and API-key env NAMES come from the single
// shared catalog (lib/ai-provider-catalog.cjs) — never re-declared here.
import * as catalog from "../lib/ai-provider-catalog.cjs";
const { ALL_PROVIDER_API_KEY_ENVS, AI_PROVIDER_API_KEY_ENVS } = catalog;

// Required in production AND preview deployments (app cannot function without these)
const ALWAYS_REQUIRED = [
  {
    name: "DATABASE_URL",
    description: "PostgreSQL connection string (postgresql:// or postgres://)",
    validate: (v) => {
      if (!v.startsWith("postgresql://") && !v.startsWith("postgres://")) {
        return `Must start with postgresql:// or postgres://. Got: "${v.slice(0, 30)}..."`;
      }
      return null;
    },
  },
  {
    name: "SESSION_SECRET",
    description: "At least 32-character random string for HMAC session signing",
    validate: (v) => {
      const INSECURE_DEFAULTS = [
        "hope-tender-path-built-in-secret-v1",
        "replace-this-with-a-64-character-random-hex-string",
        "changeme",
        "secret",
      ];
      if (v.length < 32) return `Must be at least 32 characters. Got ${v.length}.`;
      if (INSECURE_DEFAULTS.includes(v)) return "Insecure placeholder. Generate a real secret: openssl rand -hex 32";
      return null;
    },
  },
];

// AI provider keys — at least one is required in PRODUCTION. The runtime
// env-check (lib/env-check.ts) throws when all are missing, so the build
// and runtime policies must agree. Preview deployments still warn unless
// STRICT_PREVIEW_ENV_CHECK=true.
// Operator-facing chain description, DERIVED from the shared catalog.
//
// This used to be a hand-written string plus a hand-written "Rank N automatic
// provider" prefix on each of the ten descriptions — eleven places where the
// order was written down again. They went stale together the moment the order
// changed, and a build log then confidently told the operator that Z.ai was
// rank 1 in a chain that no longer existed. Descriptions were the last surface
// still printing the old order after the code had moved on.
//
// Rank, role and chain text are now generated. Only the provider-specific
// detail (endpoint quirks, key format, model env names) is written by hand.
const DISPLAY_NAMES = {
  gemini: "Gemini", groq: "Groq", mistral: "Mistral", zai: "Z.ai GLM",
  openrouter: "OpenRouter", cerebras: "Cerebras", openai: "OpenAI",
  together: "Together", deepseek: "DeepSeek", anthropic: "Anthropic / Claude",
};

const ZERO_PAID = catalog.isZeroPaidMode(process.env);
const AUTOMATIC_CHAIN = catalog.automaticProviderOrder(process.env);
const CANONICAL_CHAIN = `${AUTOMATIC_CHAIN.map((p) => DISPLAY_NAMES[p]).join(" → ")} → deterministic draft fallback`;

/** "Rank 2 free-tier provider in the automatic chain (…)." — generated. */
function roleOf(envName) {
  const provider = catalog.CANONICAL_AI_PROVIDER_ORDER.find(
    (p) => catalog.PROVIDER_API_KEY_ENV[p] === envName,
  );
  if (!provider) return "";
  const rank = catalog.CANONICAL_AI_PROVIDER_ORDER.indexOf(provider) + 1;
  if (ZERO_PAID && catalog.PAID_ACCESS_PROVIDERS.includes(provider)) {
    return `Rank ${rank}. Requires PAID access — excluded from automatic use while zero-paid mode is on, and never contacted even if this key is set. Active chain: ${CANONICAL_CHAIN}.`;
  }
  if (catalog.CONDITIONAL_FREE_PROVIDERS.includes(provider)) {
    return `Rank ${rank} aggregator, free ONLY with a verified ':free' model. Active chain: ${CANONICAL_CHAIN}.`;
  }
  return `Rank ${rank} free-tier provider in the automatic chain (${CANONICAL_CHAIN}).`;
}

// Per-key descriptions + validators, keyed by env name. This map carries NO
// ordering — the canonical order is owned solely by the shared catalog
// (ALL_PROVIDER_API_KEY_ENVS). AI_PROVIDER_KEYS below is derived from it.
const PROVIDER_KEY_META = {
  ZAI_API_KEY: {
    description: `Z.ai GLM API key. ${roleOf("ZAI_API_KEY")} General OpenAI-compatible endpoint (ZAI_BASE_URL, default https://api.z.ai/api/paas/v4). Models override via ZAI_PROPOSAL_MODEL / ZAI_ANALYSIS_MODEL / ZAI_FAST_MODEL (default glm-4.7-flash).`,
    validate: (_v) => null,
  },
  CEREBRAS_API_KEY: {
    description: `Cerebras API key. ${roleOf("CEREBRAS_API_KEY")} OpenAI-compatible endpoint that uses max_completion_tokens. Models override via CEREBRAS_PROPOSAL_MODEL / CEREBRAS_ANALYSIS_MODEL / CEREBRAS_FAST_MODEL (default gpt-oss-120b).`,
    validate: (_v) => null,
  },
  MISTRAL_API_KEY: {
    description: `Mistral API key. ${roleOf("MISTRAL_API_KEY")} Used for analysis, extraction, proposal, validation, and fast use cases. Models override via MISTRAL_PROPOSAL_MODEL / MISTRAL_ANALYSIS_MODEL / MISTRAL_FAST_MODEL.`,
    validate: (_v) => null,
  },
  GROQ_API_KEY: {
    description: `Groq API key (gsk_...). ${roleOf("GROQ_API_KEY")} Requires an explicitly configured, app-policy-proven free GROQ_PROPOSAL_MODEL.`,
    validate: (_v) => null,
  },
  OPENROUTER_API_KEY: {
    description: `OpenRouter API key (sk-or-...). ${roleOf("OPENROUTER_API_KEY")} OpenAI-compatible endpoint. OPENROUTER_PROPOSAL_MODEL MUST be an explicit ':free' model — 'openrouter/auto' and non-':free' models are rejected to prevent paid usage.`,
    validate: (_v) => null,
  },
  GEMINI_API_KEY: {
    description: `Google Gemini API key (AIza... legacy or AQ... new format). ${roleOf("GEMINI_API_KEY")} Without any AI provider key, imported records remain REGEX_DRAFT only.`,
    validate: (v) => {
      // Google AI Studio keys have historically started with "AIza" (39 chars).
      // Newer projects issue keys starting with "AQ" — accept both formats.
      if (!v.startsWith("AIza") && !v.startsWith("AQ")) {
        return `Expected a Gemini API key starting with "AIza" or "AQ". Got: "${v.slice(0, 8)}..." — check you have not set an Anthropic or OpenAI key here.`;
      }
      if (v.length < 20) return `Gemini API key is too short (${v.length} chars).`;
      return null;
    },
  },
  OPENAI_API_KEY: {
    description: `OpenAI API key (sk-...). ${roleOf("OPENAI_API_KEY")} At least one AI provider key is required in production.`,
    validate: (v) => {
      if (!v.startsWith("sk-")) return `Expected an OpenAI API key starting with "sk-". Got: "${v.slice(0, 8)}..."`;
      return null;
    },
  },
  TOGETHER_API_KEY: {
    description: `Together API key. ${roleOf("TOGETHER_API_KEY")} Models override via TOGETHER_PROPOSAL_MODEL / TOGETHER_ANALYSIS_MODEL / TOGETHER_FAST_MODEL.`,
    validate: (_v) => null,
  },
  DEEPSEEK_API_KEY: {
    description: `DeepSeek API key. ${roleOf("DEEPSEEK_API_KEY")} OpenAI-compatible endpoint (deepseek-chat / deepseek-reasoner).`,
    validate: (_v) => null, // no canonical prefix to validate
  },
  ANTHROPIC_API_KEY: {
    description: `Anthropic Claude API key (sk-ant-..., 97+ chars). ${roleOf("ANTHROPIC_API_KEY")} Keep Claude last to avoid Anthropic rate limits blocking the app when other providers are available. Get from https://console.anthropic.com/settings/keys.`,
    validate: (v) => {
      if (!v.startsWith("sk-ant-")) return `Expected a Claude API key starting with "sk-ant-". Got: "${v.slice(0, 8)}..." — check you have not set a Gemini or OpenAI key here.`;
      if (v.length < 50) return `Claude API key is too short (${v.length} chars). A real key is 97+ characters.`;
      return null;
    },
  },
};

// Derived from the single source of truth (catalog order). Never re-declare the
// order here — add metadata to PROVIDER_KEY_META keyed by env name instead.
const AI_PROVIDER_KEYS = ALL_PROVIDER_API_KEY_ENVS.map((name) => ({
  name,
  ...(PROVIDER_KEY_META[name] ?? { description: `${name} AI provider key.`, validate: (_v) => null }),
}));

// Operational readiness — important for full functionality but never a build
// blocker. Missing values surface as warnings only.
const OPERATIONAL_WARNINGS = [
  // AI_JOBS_WORKER_SECRET is in PRODUCTION_REQUIRED (not here) to avoid
  // duplicate warnings. CRON_SECRET is its accepted alternative.
  {
    name: "CRON_SECRET",
    description: "Vercel-managed Cron secret. Required when Vercel Cron is wired to /api/cron/* endpoints. Set in the Vercel dashboard, not here. Accepted as an alternative to AI_JOBS_WORKER_SECRET for draining the AI job queue.",
  },
  {
    name: "PDF_OCR_TIMEOUT_MS",
    description: "OCR call timeout in milliseconds (default 40000). Prevents Vercel FUNCTION_RUNTIME_LIMIT when the Anthropic API is slow. Set to 40000 for Vercel Hobby (60s maxDuration) or 120000 for Pro (300s maxDuration).",
  },
];

const PRODUCTION_REQUIRED = [
  {
    name: "AI_JOBS_WORKER_SECRET",
    description: "Shared secret the AI job worker uses to authenticate to the cron drainer. Without it (or CRON_SECRET), the worker queue cannot be drained by Vercel Cron in production. Production preflight fails when no valid worker/cron authentication method exists.",
  },
];

// VERCEL=1 is set on ALL Vercel builds (preview + production) — do NOT use it alone.
// Only VERCEL_ENV==="production" means an actual production deployment.
const isVercel = process.env.VERCEL === "1";
const isVercelProd = process.env.VERCEL_ENV === "production";
const isVercelPreview = isVercel && process.env.VERCEL_ENV === "preview";
const strictPreviewEnvCheck = ["1", "true", "yes"].includes((process.env.STRICT_PREVIEW_ENV_CHECK || "").trim().toLowerCase());
const isProd = process.env.NODE_ENV === "production" && (!isVercel || isVercelProd);
const errors = [];
const warnings = [];

function readNumberEnv(name) {
  const raw = process.env[name];
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function validateAiProposalRuntime() {
  const hasClaude = Boolean(process.env.ANTHROPIC_API_KEY);
  if (!hasClaude) return;

  const tier = (process.env.ANTHROPIC_TIER || "").trim();
  const explicitTokens = readNumberEnv("ANTHROPIC_MAX_OUTPUT_TOKENS");
  const explicitTimeout = readNumberEnv("AI_PROPOSAL_TIMEOUT_MS");
  const longRouteEnabled = ["1", "true", "yes"].includes((process.env.AI_PROPOSAL_LONG_ROUTE_ENABLED || "").trim().toLowerCase());
  const maxOutputTokens = explicitTokens && explicitTokens > 0 ? Math.min(explicitTokens, 64_000) : tier === "1" ? 8_000 : 16_000;
  const proposalTimeoutMs = explicitTimeout && explicitTimeout >= 5_000 && explicitTimeout <= 600_000 ? explicitTimeout : tier === "1" ? 45_000 : 220_000;
  const strict = ["1", "true", "yes"].includes((process.env.AI_PROPOSAL_STRICT_RUNTIME_CHECK || "").trim().toLowerCase());
  const findings = [];

  if (!tier) findings.push("ANTHROPIC_TIER is not set; non-Tier-1 defaults request 16K Claude output and 220s proposal timeout.");
  if (maxOutputTokens >= 16_000 && !longRouteEnabled) findings.push("16K Claude output requires AI_PROPOSAL_LONG_ROUTE_ENABLED=true and deployment runtime that supports long functions.");
  if (proposalTimeoutMs > 45_000 && !longRouteEnabled) findings.push(`${Math.round(proposalTimeoutMs / 1000)}s proposal timeout requires AI_PROPOSAL_LONG_ROUTE_ENABLED=true and long-function runtime capacity.`);
  if (tier === "1" && maxOutputTokens > 8_000) findings.push("ANTHROPIC_TIER=1 is configured but ANTHROPIC_MAX_OUTPUT_TOKENS exceeds 8000.");

  if (findings.length === 0) return;

  const message = [
    "AI proposal runtime configuration is unsafe for default 60s routes:",
    ...findings.map((finding) => `    - ${finding}`),
    "    Recommended: set ANTHROPIC_TIER=1 for 60s deployments, or enable AI_PROPOSAL_LONG_ROUTE_ENABLED=true only after confirming long-function runtime capacity.",
  ].join("\n");

  // Runtime config issues are warnings, not build blockers. Failing the
  // production build here prevents the deployment that would actually serve
  // users — it's better to deploy with a sub-optimal config than to not
  // deploy at all. Use AI_PROPOSAL_STRICT_RUNTIME_CHECK=true to opt in to
  // hard enforcement if you need it.
  if (strict) errors.push(`  ✗ AI_PROPOSAL_RUNTIME: ${message}`);
  else warnings.push(`  ⚠  AI_PROPOSAL_RUNTIME: ${message}`);
}

// AI provider key validation per-key (warns on shape problems, never blocks
// production build on a present-but-malformed key — the runtime check fires
// when the SDK is actually invoked).
for (const spec of AI_PROVIDER_KEYS) {
  const value = process.env[spec.name];
  if (!value) {
    warnings.push(`  ⚠  ${spec.name}: Not set. ${spec.description}`);
    continue;
  }
  if (spec.validate) {
    const err = spec.validate(value);
    if (err) warnings.push(`  ⚠  ${spec.name}: ${err}`);
  }
}

for (const spec of ALWAYS_REQUIRED) {
  const value = process.env[spec.name];
  const previewRelaxed = isVercelPreview && !strictPreviewEnvCheck;
  if (!value) {
    if (previewRelaxed) warnings.push(`  ⚠  ${spec.name}: Missing in Vercel preview. Deploy will continue, but runtime APIs depending on this variable will fail until configured.`);
    else errors.push(`  ✗ ${spec.name}: ${spec.description}`);
    continue;
  }
  if (spec.validate) {
    const err = spec.validate(value);
    if (err) {
      if (previewRelaxed) warnings.push(`  ⚠  ${spec.name}: ${err} (preview build allowed; runtime may fail)`);
      else errors.push(`  ✗ ${spec.name}: ${err}`);
    }
  }
}

// Gap 5 — match lib/env-check.ts: at least one AI provider key is required
// in production. All 10 providers are automatic:
// Z.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI →
// Together → DeepSeek → Anthropic (emergency-only last resort).
// Preview deployments warn unless STRICT_PREVIEW_ENV_CHECK=true.
// Development is unaffected (warn-only).
const AI_PROVIDER_KEYS_CHECK = AI_PROVIDER_API_KEY_ENVS.map((name) => ({ name }));
const hasAnyAIKey = AI_PROVIDER_KEYS_CHECK.some(({ name }) => Boolean(process.env[name]));
if (!hasAnyAIKey) {
  const message =
    `At least one AI provider key is required: ${AI_PROVIDER_KEYS_CHECK.map((k) => k.name).join(", ")}. ` +
    "Without any AI key, every imported expert/project is REGEX_DRAFT and BLOCKED from final proposal generation.";
  if (isProd) {
    errors.push(`  ✗ AI_PROVIDER_KEYS: ${message}`);
  } else if (isVercelPreview && strictPreviewEnvCheck) {
    errors.push(`  ✗ AI_PROVIDER_KEYS: ${message}`);
  } else {
    warnings.push(`  ⚠  AI_PROVIDER_KEYS: ${message}`);
  }
}

for (const spec of OPERATIONAL_WARNINGS) {
  if (!process.env[spec.name]) {
    // PDF_OCR_TIMEOUT_MS has a safe default (40000ms) — don't warn if unset,
    // just inform. The runtime code already defaults to 40000.
    if (spec.name === "PDF_OCR_TIMEOUT_MS") continue;
    warnings.push(`  ⚠  ${spec.name}: Not set. ${spec.description}`);
  }
}

for (const spec of PRODUCTION_REQUIRED) {
  const value = process.env[spec.name];
  // AI_JOBS_WORKER_SECRET is satisfied if either it OR CRON_SECRET is set
  // (both authenticate the AI job cron drainer).
  const hasAlternative = spec.name === "AI_JOBS_WORKER_SECRET" && process.env.CRON_SECRET;
  if (isProd && !value && !hasAlternative) {
    errors.push(`  ✗ ${spec.name}: ${spec.description} [PRODUCTION REQUIRED]`);
    continue;
  }
  if (!value && !hasAlternative) {
    warnings.push(`  ⚠  ${spec.name}: Not set. ${spec.description}`);
    continue;
  }
  if (spec.validate && value) {
    const err = spec.validate(value);
    if (err) {
      if (isProd) errors.push(`  ✗ ${spec.name}: ${err} [PRODUCTION REQUIRED]`);
      else warnings.push(`  ⚠  ${spec.name}: ${err}`);
    }
  }
}

validateAiProposalRuntime();

if (warnings.length > 0) {
  console.warn("\n⚠  BUILD WARNINGS — environment configuration issues:\n");
  for (const w of warnings) console.warn(w);
  console.warn("");
}

if (errors.length > 0) {
  const border = "═".repeat(63);
  console.error(`\n${border}`);
  console.error("  FATAL: Required environment variables are missing or invalid.");
  console.error("  This build cannot succeed. Fix these before deploying.");
  console.error(border);
  console.error("\nMissing / invalid variables:");
  for (const e of errors) console.error(e);
  console.error(`
Set these in your .env.local (development) or in the Vercel
dashboard under Settings → Environment Variables (production).
See .env.example for the expected format.
${border}\n`);
  process.exit(1);
}

console.log("✓ Environment validation passed" + (isProd ? " (production mode)" : isVercel ? " (Vercel preview mode)" : " (development mode)"));
