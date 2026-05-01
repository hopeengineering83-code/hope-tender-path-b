/**
 * scripts/check-env.mjs
 *
 * Build-time environment validation.
 *
 * Vercel can build the application in an environment where runtime variables are
 * not fully exposed to the build process. Therefore this script warns by default
 * and only fails when STRICT_ENV_CHECK=1 is set. Runtime code still requires the
 * actual variables when protected app features are used.
 */

const RUNTIME_REQUIRED = [
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

const OPTIONAL = [
  {
    name: "GEMINI_API_KEY",
    description:
      "Google Gemini API key for AI extraction. Without this, all imported records are REGEX_DRAFT only.",
    validate: (v) => {
      if (v.length < 10) return `Too short to be a valid Gemini API key (got ${v.length} chars).`;
      return null;
    },
  },
];

const strict = process.env.STRICT_ENV_CHECK === "1";
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

for (const spec of RUNTIME_REQUIRED) {
  const value = process.env[spec.name];
  if (!value) {
    const msg = `  ✗ ${spec.name}: ${spec.description}`;
    if (strict) errors.push(msg);
    else warnings.push(`  ⚠  ${spec.name}: Missing at build time. Required at runtime. ${spec.description}`);
    continue;
  }
  if (spec.validate) {
    const err = spec.validate(value);
    if (err) {
      const msg = `  ✗ ${spec.name}: ${err}`;
      if (strict) errors.push(msg);
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
  console.error("  This build cannot succeed with STRICT_ENV_CHECK=1.");
  console.error(border);
  console.error("\nMissing / invalid variables:");
  for (const e of errors) console.error(e);
  console.error(`\n${border}\n`);
  process.exit(1);
}

console.log("✓ Environment validation completed" + (strict ? " (strict mode)" : " (warning mode)"));
