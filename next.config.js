// @ts-check

/**
 * Production environment guard.
 * Fails the build / startup loudly if required env vars are missing,
 * so a Vercel deployment never silently degrades.
 */
function assertProductionEnv() {
  if (process.env.NODE_ENV !== "production") return;

  // DATABASE_URL and SESSION_SECRET are unconditionally required.
  // AI is enabled when any supported provider is configured. The default
  // chain is OpenAI → Gemini → Mistral → DeepSeek → Groq → Together → OpenRouter → Claude;
  // Claude/Anthropic remains last so rate limits do not block the app.
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

  const aiProviderKeys = [
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "MISTRAL_API_KEY",
    "DEEPSEEK_API_KEY",
    "GROQ_API_KEY",
    "TOGETHER_API_KEY",
    "OPENROUTER_API_KEY",
    "ANTHROPIC_API_KEY",
  ];

  // AI key requirement — at least one supported provider must be present.
  if (!aiProviderKeys.some((name) => Boolean(process.env[name]))) {
    console.error(
      "\n╔══════════════════════════════════════════════════════════════╗" +
      "\n║  BUILD FAILED — No AI provider key configured.              ║" +
      "\n╚══════════════════════════════════════════════════════════════╝" +
      "\n\nSet at least one of:" +
      "\n  ✗ OPENAI_API_KEY      (first in default chain)" +
      "\n  ✗ GEMINI_API_KEY      (analysis/extraction primary; second in proposal chain)" +
      "\n  ✗ MISTRAL_API_KEY     (third in default chain; analysis fallback)" +
      "\n  ✗ DEEPSEEK_API_KEY    (fourth in default chain)" +
      "\n  ✗ GROQ_API_KEY        (fifth in default chain; fast/cheap primary)" +
      "\n  ✗ TOGETHER_API_KEY    (sixth in default chain; fast/cheap secondary)" +
      "\n  ✗ OPENROUTER_API_KEY  (seventh in default chain)" +
      "\n  ✗ ANTHROPIC_API_KEY   (Claude/Anthropic last-resort provider)" +
      "\n\nWithout any AI provider, AI proposal generation and CV/project extraction\nare disabled and imported records remain REGEX_DRAFT only.\n"
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
  // Surface AI availability in the build output without exposing which secrets
  // are configured. Mirrors the six-provider server-side policy above.
  env: {
    NEXT_PUBLIC_AI_ENABLED: ["OPENAI_API_KEY", "GEMINI_API_KEY", "DEEPSEEK_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY"]
      .some((name) => Boolean(process.env[name])) ? "true" : "false",
  },
};

module.exports = nextConfig;
