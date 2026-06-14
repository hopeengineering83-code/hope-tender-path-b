// @ts-check
const createNextIntlPlugin = require("next-intl/plugin");
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

function assertProductionEnv() {
  if (process.env.NODE_ENV !== "production") return;

  const required = [
    ["DATABASE_URL", "PostgreSQL connection string"],
    ["SESSION_SECRET", "session signing secret with at least 32 characters"],
  ];
  const missing = required.filter(([name]) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required production variables: ${missing.map(([name]) => name).join(", ")}`);
  }

  const providerKeys = [
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "OPENAI_API_KEY",
    "GROQ_API_KEY",
    "DEEPSEEK_API_KEY",
    "ANTHROPIC_API_KEY",
  ];
  if (!providerKeys.some((name) => Boolean(process.env[name]))) {
    throw new Error(`Configure at least one supported AI provider: ${providerKeys.join(", ")}`);
  }

  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://")) {
    throw new Error("DATABASE_URL must use PostgreSQL in production");
  }

  const secret = process.env.SESSION_SECRET ?? process.env.AUTH_SECRET ?? "";
  if (secret.length < 32) throw new Error("SESSION_SECRET or AUTH_SECRET must contain at least 32 characters");
}

assertProductionEnv();

const isProduction = process.env.NODE_ENV === "production";
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "X-Frame-Options", value: "DENY" },
  ...(isProduction ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pdf-parse", "mammoth", "bcryptjs", "xlsx", "@anthropic-ai/sdk"],
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  env: {
    NEXT_PUBLIC_AI_ENABLED: [
      "GEMINI_API_KEY",
      "OPENROUTER_API_KEY",
      "OPENAI_API_KEY",
      "GROQ_API_KEY",
      "DEEPSEEK_API_KEY",
      "ANTHROPIC_API_KEY",
    ].some((name) => Boolean(process.env[name])) ? "true" : "false",
    NEXT_PUBLIC_BUILD_SHA: (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? "").slice(0, 8) || "dev",
    NEXT_PUBLIC_BUILD_ENV: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
};

module.exports = withNextIntl(nextConfig);
