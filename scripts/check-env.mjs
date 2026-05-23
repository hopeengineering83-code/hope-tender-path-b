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
// env-check (lib/env-check.ts) throws when both are missing, so the build
// and runtime policies must agree. Preview deployments still warn unless
// STRICT_PREVIEW_ENV_CHECK=true.
const AI_PROVIDER_KEYS = [
  {
    name: "ANTHROPIC_API_KEY",
    description:
      "Anthropic Claude API key (sk-ant-..., 97+ chars). PREFERRED provider for proposal generation; the reference benchmark is Claude-generated so output quality is highest with Claude. Get from https://console.anthropic.com/settings/keys.",
    validate: (v) => {
      if (!v.startsWith("sk-ant-")) return `Expected a Claude API key starting with "sk-ant-". Got: "${v.slice(0, 8)}..." — check you have not set a Gemini or OpenAI key here.`;
      if (v.length < 50) return `Claude API key is too short (${v.length} chars). A real key is 97+ characters.`;
      return null;
    },
  },
  {
    name: "GEMINI_API_KEY",
    description:
      "Google Gemini API key (AIza..., 39 chars). Secondary fallback for proposal generation and primary engine for CV/project extraction. Without this AND ANTHROPIC_API_KEY, all imported records are REGEX_DRAFT only.",
    validate: (v) => {
      if (!v.startsWith("AIza")) return `Expected a Gemini API key starting with "AIza". Got: "${v.slice(0, 8)}..." — check you have not set an Anthropic or OpenAI key here.`;
      if (v.length < 35) return `Gemini API key is too short (${v.length} chars). A real key is 39 characters.`;
      return null;
    },
  },
  {
    name: "OPENAI_API_KEY",
    description:
      "OpenAI API key (sk-...). Third-tier fallback for proposal generation (Claude → Gemini → OpenAI → DeepSeek). Optional but recommended for resilience. Get from https://platform.openai.com/api-keys.",
    validate: (v) => {
      if (!v.startsWith("sk-")) return `Expected an OpenAI API key starting with "sk-". Got: "${v.slice(0, 8)}...".`;
      if (v.length < 30) return `OpenAI API key looks too short (${v.length} chars).`;
      return null;
    },
  },
  {
    name: "DEEPSEEK_API_KEY",
    description:
      "DeepSeek API key. Fourth-tier fallback for proposal generation (Claude → Gemini → OpenAI → DeepSeek). Optional. Get from https://platform.deepseek.com/api_keys.",
    validate: (v) => {
      if (v.length < 10) return `DeepSeek API key looks too short (${v.length} chars).`;
      return null;
    },
  },
];

// Operational readiness — important for full functionality but never a build
// blocker. Missing values surface as warnings only.
const OPERATIONAL_WARNINGS = [
  {
    name: "AI_JOBS_WORKER_SECRET",
    description: "Shared secret the AI job worker uses to authenticate to the cron drainer. Without it, the worker queue cannot be drained by Vercel Cron in production.",
  },
  {
    name: "CRON_SECRET",
    description: "Vercel-managed Cron secret. Required when Vercel Cron is wired to /api/cron/* endpoints. Set in the Vercel dashboard, not here.",
  },
];

const PRODUCTION_REQUIRED = [];

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

// Gap 5 — match lib/env-check.ts: at least one AI provider key is required in
// production. Preview deployments warn unless STRICT_PREVIEW_ENV_CHECK=true.
// Development is unaffected (warn-only).
const hasAnyAIKey = AI_PROVIDER_KEYS.some(({ name }) => Boolean(process.env[name]));
if (!hasAnyAIKey) {
  const message =
    "At least one AI provider key is required: ANTHROPIC_API_KEY (preferred), GEMINI_API_KEY, OPENAI_API_KEY, or DEEPSEEK_API_KEY. " +
    "Without any of these, every imported expert/project is REGEX_DRAFT and BLOCKED from final proposal generation.";
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
    warnings.push(`  ⚠  ${spec.name}: Not set. ${spec.description}`);
  }
}

for (const spec of PRODUCTION_REQUIRED) {
  const value = process.env[spec.name];
  if (isProd && !value) {
    errors.push(`  ✗ ${spec.name}: ${spec.description} [PRODUCTION REQUIRED]`);
    continue;
  }
  if (!value) {
    warnings.push(`  ⚠  ${spec.name}: Not set. AI extraction will be disabled — all records will be REGEX_DRAFT only.`);
    continue;
  }
  if (spec.validate) {
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
