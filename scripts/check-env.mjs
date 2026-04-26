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

// ── Required in ALL environments ─────────────────────────────────────────────
//
// ARCHITECTURE NOTE: ANTHROPIC_API_KEY is always required because without it
// the AI extraction pipeline is disabled and every imported expert/project is
// classified as REGEX_DRAFT. REGEX_DRAFT records are *blocked* from use in final
// proposal generation (by design). This means a deployment without the API key
// can never complete the full proposal workflow — it is architecturally broken.
//
const ALWAYS_REQUIRED = [
  {
    name: "DATABASE_URL",
    description: "PostgreSQL connection string (postgresql:// or postgres://)",
    validate: (v) => {
      if (!v.startsWith("postgresql://") && !v.startsWith("postgres://")) {
        return `Must start with postgresql:// or postgres://. SQLite is not supported. Got: "${v.slice(0, 30)}..."`;
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
      if (INSECURE_DEFAULTS.includes(v)) return "This is an insecure placeholder value. Generate a real secret with: openssl rand -hex 32";
      return null;
    },
  },
  {
    name: "ANTHROPIC_API_KEY",
    description:
      "Anthropic API key (sk-ant-...) — required for AI extraction (CVs → experts, portfolios → projects). " +
      "Without this key ALL imported records are REGEX_DRAFT, which is blocked from final proposal generation.",
    validate: (v) => {
      if (!v.startsWith("sk-ant-")) return `Expected an Anthropic key starting with sk-ant-. Got: "${v.slice(0, 10)}..."`;
      return null;
    },
  },
];

// ── No production-only requirements beyond the above ─────────────────────────
const PRODUCTION_REQUIRED = [];

// ─── Run checks ───────────────────────────────────────────────────────────────

const isProd = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production" || process.env.VERCEL === "1";
const errors = [];
const warnings = [];

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

// ── Print results ─────────────────────────────────────────────────────────────

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

console.log("✓ Environment validation passed" + (isProd ? " (production mode)" : " (development mode)"));
