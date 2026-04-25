// @ts-check

/**
 * Production environment guard.
 * Fails the build / startup loudly if required env vars are missing,
 * so a Vercel deployment never silently degrades.
 */
function assertProductionEnv() {
  if (process.env.NODE_ENV !== "production") return;

  const required = [
    ["DATABASE_URL", "PostgreSQL connection string"],
    ["SESSION_SECRET", "HMAC session signing secret (min 32 chars)"],
    ["GEMINI_API_KEY", "Anthropic API key for AI extraction and proposal generation"],
  ];

  const missing = required.filter(([name]) => !process.env[name]);
  if (missing.length > 0) {
    const lines = [
      "",
      "╔══════════════════════════════════════════════════════════════╗",
      "║  BUILD FAILED — Required production env vars are missing.   ║",
      "╚══════════════════════════════════════════════════════════════╝",
      "",
      "Missing variables (set in Vercel dashboard or .env.production):",
      ...missing.map(([name, desc]) => `  ✗ ${name}: ${desc}`),
      "",
      "The app will not start without these. Add them before deploying.",
      "",
    ];
    console.error(lines.join("\n"));
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://")) {
    console.error(
      "\n✗ DATABASE_URL must be a PostgreSQL connection string (postgresql:// or postgres://).\n" +
      "  SQLite is not supported in production. Use Neon, Supabase, Railway, or similar.\n"
    );
    process.exit(1);
  }

  const secret = process.env.SESSION_SECRET ?? "";
  if (secret.length < 32) {
    console.error(`\n✗ SESSION_SECRET is too short (${secret.length} chars). Use at least 32 random characters.\n`);
    process.exit(1);
  }
}

assertProductionEnv();

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: true,
  },
  // Surface missing env vars in the build output
  env: {
    NEXT_PUBLIC_AI_ENABLED: process.env.GEMINI_API_KEY ? "true" : "false",
  },
};

module.exports = nextConfig;
