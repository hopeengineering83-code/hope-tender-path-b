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

// Optional — app builds and runs without these, but with reduced capability.
// At least one of ANTHROPIC_API_KEY or GEMINI_API_KEY should be set for AI
// generation; the proposal pipeline prefers Claude when available, and falls
// back to Gemini for both proposal generation and CV/project extraction.
const OPTIONAL = [
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
      "Google Gemini API key (AIza..., 39 chars). Used as a fallback for proposal generation and as the primary engine for CV/project extraction. Without this AND ANTHROPIC_API_KEY, all imported records are REGEX_DRAFT only.",
    validate: (v) => {
      if (!v.startsWith("AIza")) return `Expected a Gemini API key starting with "AIza". Got: "${v.slice(0, 8)}..." — check you have not set an Anthropic or OpenAI key here.`;
      if (v.length < 35) return `Gemini API key is too short (${v.length} chars). A real key is 39 characters.`;
      return null;
    },
  },
];

const PRODUCTION_REQUIRED = [];

// VERCEL=1 is set on ALL Vercel builds (preview + production) — do NOT use it alone.
// Only VERCEL_ENV==="production" means an actual production deployment.
const isVercel = process.env.VERCEL === "1";
const isVercelProd = process.env.VERCEL_ENV === "production";
const isProd = process.env.NODE_ENV === "production" && (!isVercel || isVercelProd);
const errors = [];
const warnings = [];

for (const spec of OPTIONAL) {
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
  if (!value) {
    errors.push(`  ✗ ${spec.name}: ${spec.description}`);
    continue;
  }
  if (spec.validate) {
    const err = spec.validate(value);
    if (err) errors.push(`  ✗ ${spec.name}: ${err}`);
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
