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
  const isSqlite = databaseUrl.startsWith("file:") || databaseUrl.includes("/tmp/app.db") || databaseUrl.length === 0;
  const checks: ReadinessCheck[] = [
    {
      key: "database",
      title: "Persistent PostgreSQL database",
      severity: isSqlite ? "CRITICAL" : "OK",
      requiredForProduction: true,
      detail: isSqlite
        ? "The app is not connected to a persistent PostgreSQL database. A temporary SQLite database cannot be used as the permanent company knowledge base."
        : "DATABASE_URL is configured. Confirm it points to a managed PostgreSQL database and not a temporary file database.",
    },
    {
      key: "ai_extraction",
      title: "AI extraction key",
      severity: has(process.env.GEMINI_API_KEY) ? "OK" : "CRITICAL",
      requiredForProduction: true,
      detail: has(process.env.GEMINI_API_KEY)
        ? "GEMINI_API_KEY is configured for deep tender and company-knowledge extraction."
        : "GEMINI_API_KEY is missing. Complex PDFs can only be parsed with weak rule-based extraction until this is configured.",
    },
    {
      key: "session_secret",
      title: "Session secret",
      severity: has(process.env.SESSION_SECRET) || has(process.env.AUTH_SECRET) ? "OK" : "WARNING",
      requiredForProduction: true,
      detail: has(process.env.SESSION_SECRET) || has(process.env.AUTH_SECRET)
        ? "A session/auth secret appears configured."
        : "No SESSION_SECRET or AUTH_SECRET detected. Configure one stable secret for production sessions.",
    },
    {
      key: "file_storage",
      title: "Durable file storage",
      severity: has(process.env.BLOB_READ_WRITE_TOKEN) || has(process.env.S3_BUCKET) ? "OK" : "WARNING",
      requiredForProduction: true,
      detail: has(process.env.BLOB_READ_WRITE_TOKEN) || has(process.env.S3_BUCKET)
        ? "A durable file storage configuration appears present."
        : "No durable file storage token is configured. The current database base64 storage is acceptable only for small Phase-1 testing, not heavy production files.",
    },
  ];

  return {
    productionReady: checks.every((check) => check.severity !== "CRITICAL"),
    checks,
  };
}
