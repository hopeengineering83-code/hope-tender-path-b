/**
 * Startup environment validation.
 * Imported at the top of lib/prisma.ts so it runs on every cold start.
 * Fails LOUDLY — throws at module load time so the process crashes with
 * a clear message rather than silently degrading.
 *
 * ARCHITECTURE: GEMINI_API_KEY is required in ALL environments because:
 *   - Without it, every imported expert/project is classified as REGEX_DRAFT
 *   - REGEX_DRAFT records are BLOCKED from use in final proposal generation
 *   - A deployment without the key can never complete the proposal workflow
 */

const REQUIRED_VARS: Array<{ name: string; description: string }> = [
  { name: "DATABASE_URL", description: "PostgreSQL connection string (postgresql://...)" },
  { name: "SESSION_SECRET", description: "At least 32-character random string for HMAC session signing" },
  {
    name: "GEMINI_API_KEY",
    description:
      "Google Gemini API key — required for AI extraction. Without this, all imported records " +
      "are REGEX_DRAFT and will be BLOCKED from final proposal generation.",
  },
];

const PRODUCTION_REQUIRED: Array<{ name: string; description: string }> = [];

const INSECURE_DEFAULTS: Record<string, string> = {
  SESSION_SECRET: "hope-tender-path-built-in-secret-v1",
};

export function checkEnv(): void {
  const missing: string[] = [];
  const insecure: string[] = [];
  const isProd = process.env.NODE_ENV === "production";

  for (const { name, description } of REQUIRED_VARS) {
    const value = process.env[name];
    if (!value) {
      missing.push(`  ✗ ${name}: ${description}`);
    } else if (INSECURE_DEFAULTS[name] && value === INSECURE_DEFAULTS[name]) {
      insecure.push(`  ⚠ ${name} is using the insecure default value. Set a real secret.`);
    }
  }

  if (isProd) {
    for (const { name, description } of PRODUCTION_REQUIRED) {
      if (!process.env[name]) {
        missing.push(`  ✗ ${name}: ${description}`);
      }
    }
  }

  if (missing.length > 0) {
    const lines = [
      "",
      "═══════════════════════════════════════════════════════════",
      "  FATAL: Required environment variables are not configured.",
      "  The application cannot start without these variables.",
      "═══════════════════════════════════════════════════════════",
      "",
      "Missing variables:",
      ...missing,
      "",
      "Set these in your .env.local (development) or Vercel dashboard (production).",
      "See .env.example for the expected format.",
      "═══════════════════════════════════════════════════════════",
      "",
    ];
    console.error(lines.join("\n"));
    throw new Error(
      `Missing required environment variables: ${missing.map((l) => l.trim().split(":")[0]).join(", ")}`,
    );
  }

  if (insecure.length > 0) {
    console.warn("\n⚠  SECURITY WARNING — insecure defaults detected:\n" + insecure.join("\n") + "\n");
  }

  // Validate DATABASE_URL format — SQLite is never acceptable
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://")) {
    throw new Error(
      `DATABASE_URL must be a PostgreSQL connection string starting with postgresql:// or postgres://. ` +
      `Got: "${dbUrl.slice(0, 30)}...". SQLite is not supported.`,
    );
  }

  // Warn if SESSION_SECRET is too short
  const secret = process.env.SESSION_SECRET ?? "";
  if (secret.length < 32) {
    console.warn(
      `⚠  SESSION_SECRET is only ${secret.length} characters. Use at least 32 random characters.`,
    );
  }
}

export function isAIConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

// Alias used in diagnostics and other routes
export function isAIEnabled(): boolean {
  return isAIConfigured();
}
