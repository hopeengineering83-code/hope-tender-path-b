// @ts-check

/**
 * Production environment guard.
 * Fails the build / startup loudly if required env vars are missing,
 * so a Vercel deployment never silently degrades.
 */
function assertProductionEnv() {
  if (process.env.NODE_ENV !== "production") return;

  // DATABASE_URL and SESSION_SECRET are unconditionally required.
  // The AI key requirement is "either ANTHROPIC_API_KEY or GEMINI_API_KEY"
  // — both are accepted by lib/ai.ts (Claude preferred, Gemini fallback).
  const required = [
    ["DATABASE_URL", "PostgreSQL connection string"],
    ["SESSION_SECRET", "HMAC session signing secret (min 32 chars)"],
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

  // AI key requirement — at least one of the two must be present.
  if (!process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY) {
    console.error(
      "\n╔══════════════════════════════════════════════════════════════╗" +
      "\n║  BUILD FAILED — No AI provider key configured.              ║" +
      "\n╚══════════════════════════════════════════════════════════════╝" +
      "\n\nSet at least one of:" +
      "\n  ✗ ANTHROPIC_API_KEY  (preferred — Claude provider)" +
      "\n  ✗ GEMINI_API_KEY     (fallback — Gemini provider)" +
      "\n\nWithout either, AI proposal generation and CV/project extraction\nare disabled and imported records remain REGEX_DRAFT only.\n"
    );
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
  // pdf-parse, mammoth, bcryptjs load native binaries — must stay in Node, not bundled by webpack.
  // @anthropic-ai/sdk is loaded via require() at runtime so webpack should not bundle it server-side.
  serverExternalPackages: ["pdf-parse", "mammoth", "bcryptjs", "xlsx", "@anthropic-ai/sdk"],
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  // Surface missing env vars in the build output. AI is enabled when EITHER
  // provider is configured (lib/ai.ts accepts both, Claude preferred).
  env: {
    NEXT_PUBLIC_AI_ENABLED: (process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY) ? "true" : "false",
  },
};

module.exports = nextConfig;
