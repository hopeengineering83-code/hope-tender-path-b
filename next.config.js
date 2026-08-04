// @ts-check
const createNextIntlPlugin = require("next-intl/plugin");
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");
const {
  resolveDeploymentEnvironment,
  resolveBuildSha,
} = require("./lib/deployment-context.cjs");

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

  // Provider key names come from the single shared catalog — NOT duplicated
  // here. The catalog (lib/ai-provider-catalog.cjs) is the one source the typed
  // registry, this build guard, and scripts/check-env.mjs all consume.
  const { AI_PROVIDER_API_KEY_ENVS } = require("./lib/ai-provider-catalog.cjs");
  if (!AI_PROVIDER_API_KEY_ENVS.some((name) => Boolean(process.env[name]))) {
    throw new Error(`Configure at least one supported AI provider: ${AI_PROVIDER_API_KEY_ENVS.join(", ")}`);
  }

  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://")) {
    throw new Error("DATABASE_URL must use PostgreSQL in production");
  }

  const secret = process.env.SESSION_SECRET ?? process.env.AUTH_SECRET ?? "";
  if (secret.length < 32) throw new Error("SESSION_SECRET or AUTH_SECRET must contain at least 32 characters");
}

assertProductionEnv();

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Runtime response security headers are single-sourced in middleware.ts.
  // Keep server-only packages external where their native/runtime behavior
  // requires it; do not remove active providers or document libraries here.
  serverExternalPackages: ["pdf-parse", "pdf2json", "pdfjs-dist", "mammoth", "bcryptjs", "@e965/xlsx", "@anthropic-ai/sdk", "@google/generative-ai", "openai", "undici", "docx", "pdf-lib", "jszip"],
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  env: {
    // Vercel mints a NEW hostname for every deployment, so a bookmarked
    // preview URL goes stale on the next commit. VERCEL_BRANCH_URL is the
    // stable per-branch alias that always resolves to the newest deployment
    // for that branch — bookmark it once and it never needs updating. Exposed
    // here so the build badge can surface it instead of the owner hunting for
    // a fresh link in the PR comments after every push.
    NEXT_PUBLIC_BRANCH_URL: process.env.VERCEL_BRANCH_URL ?? "",
    NEXT_PUBLIC_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "",
    NEXT_PUBLIC_GIT_BRANCH: process.env.VERCEL_GIT_COMMIT_REF ?? "",
    // Use the shared catalog so the build-time flag agrees with the runtime
    // check in lib/env-check.ts. Previously this hardcoded 8 of the 10
    // canonical providers (omitted ZAI_API_KEY + CEREBRAS_API_KEY), so a
    // build with only Z.ai configured would report AI as disabled.
    NEXT_PUBLIC_AI_ENABLED: require("./lib/ai-provider-catalog.cjs").AI_PROVIDER_API_KEY_ENVS.some(
      (name) => Boolean(process.env[name]),
    ) ? "true" : "false",
    // Deployment identity is not equivalent to NODE_ENV. Next.js uses
    // NODE_ENV=production for Vercel previews, CI screenshot runs, and local
    // production-mode builds, so only VERCEL_ENV may claim a real production
    // or preview deployment. resolveBuildSha reads the safe Vercel system
    // value process.env.VERCEL_GIT_COMMIT_SHA before the non-Vercel fallback.
    NEXT_PUBLIC_BUILD_SHA: resolveBuildSha(process.env),
    NEXT_PUBLIC_BUILD_ENV: resolveDeploymentEnvironment(process.env),
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
};

module.exports = withNextIntl(nextConfig);
