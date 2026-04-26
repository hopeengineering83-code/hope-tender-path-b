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
      title: "AI extraction key (Anthropic Claude)",
      severity: has(process.env.ANTHROPIC_API_KEY) ? "OK" : "CRITICAL",
      requiredForProduction: true,
      detail: has(process.env.ANTHROPIC_API_KEY)
        ? "ANTHROPIC_API_KEY is configured. Claude AI extraction is enabled for CVs, project portfolios, and tender documents."
        : "ANTHROPIC_API_KEY is missing. Complex PDFs can only be parsed with weak rule-based (regex) extraction. All imported records will be REGEX_DRAFT and cannot be used in final proposals.",
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
