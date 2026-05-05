export type ReadinessSeverity = "OK" | "WARNING" | "CRITICAL";

export type ReadinessCheck = {
  key: string;
  title: string;
  severity: ReadinessSeverity;
  detail: string;
  requiredForProduction: boolean;
};

export type SystemReadiness = {
  productionReady: boolean;
  checks: ReadinessCheck[];
};

function has(value: string | undefined | null) {
  return Boolean(value && value.trim().length > 0);
}

export function getSystemReadiness(): SystemReadiness {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const isSqlite =
    databaseUrl.startsWith("file:") ||
    databaseUrl.includes("/tmp/app.db") ||
    databaseUrl.length === 0;

  const checks: ReadinessCheck[] = [
    {
      key: "database",
      title: "Persistent PostgreSQL database",
      severity: isSqlite ? "CRITICAL" : "OK",
      requiredForProduction: true,
      detail: isSqlite
        ? "The app is not connected to a persistent PostgreSQL database. SQLite cannot store company knowledge permanently."
        : "DATABASE_URL is configured. Verify it points to a managed PostgreSQL provider (Neon, Supabase, Railway, etc.).",
    },
    {
      key: "ai_extraction",
      title: "AI provider key (Claude preferred, Gemini fallback)",
      // OK when either provider is configured. The AI surfaces accept both:
      // Claude (lib/ai.ts) for proposal generation when ANTHROPIC_API_KEY is
      // set, Gemini for proposal generation fallback and CV/project extraction.
      severity: has(process.env.ANTHROPIC_API_KEY) || has(process.env.GEMINI_API_KEY) ? "OK" : "CRITICAL",
      requiredForProduction: true,
      detail:
        has(process.env.ANTHROPIC_API_KEY) && has(process.env.GEMINI_API_KEY)
          ? "Both ANTHROPIC_API_KEY and GEMINI_API_KEY are configured. Proposal generation uses Claude (preferred); CV/project extraction uses Gemini."
          : has(process.env.ANTHROPIC_API_KEY)
          ? "ANTHROPIC_API_KEY is configured. Claude is enabled for proposal generation. CV/project extraction will run if GEMINI_API_KEY is also set; otherwise extraction degrades to regex-only and imported records remain REGEX_DRAFT."
          : has(process.env.GEMINI_API_KEY)
          ? "GEMINI_API_KEY is configured. Gemini is enabled for proposal generation and CV/project extraction. Set ANTHROPIC_API_KEY to switch generation to Claude (preferred)."
          : "No AI provider key set (ANTHROPIC_API_KEY or GEMINI_API_KEY). Complex PDFs can only be parsed with weak rule-based (regex) extraction. All imported records will be REGEX_DRAFT and cannot be used in final proposals.",
    },
    {
      key: "session_secret",
      title: "Session secret",
      severity:
        has(process.env.SESSION_SECRET) || has(process.env.AUTH_SECRET) ? "OK" : "WARNING",
      requiredForProduction: true,
      detail:
        has(process.env.SESSION_SECRET) || has(process.env.AUTH_SECRET)
          ? "A session/auth secret appears configured."
          : "No SESSION_SECRET or AUTH_SECRET detected. Configure one stable secret for production sessions.",
    },
    {
      key: "file_storage",
      title: "Durable file storage",
      severity:
        has(process.env.BLOB_READ_WRITE_TOKEN) || has(process.env.S3_BUCKET) ? "OK" : "WARNING",
      requiredForProduction: true,
      detail:
        has(process.env.BLOB_READ_WRITE_TOKEN) || has(process.env.S3_BUCKET)
          ? "A durable file storage configuration appears present."
          : "No durable file storage token configured. Current database base64 storage is only suitable for small-scale testing.",
    },
  ];

  return {
    productionReady: checks.every((check) => check.severity !== "CRITICAL"),
    checks,
  };
}
