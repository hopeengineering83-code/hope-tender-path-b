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

function configuredAiProviders(): string[] {
  const providers: string[] = [];
  if (has(process.env.OPENAI_API_KEY)) providers.push("OpenAI");
  if (has(process.env.GEMINI_API_KEY)) providers.push("Gemini");
  if (has(process.env.MISTRAL_API_KEY)) providers.push("Mistral");
  if (has(process.env.DEEPSEEK_API_KEY)) providers.push("DeepSeek");
  if (has(process.env.GROQ_API_KEY)) providers.push("Groq");
  if (has(process.env.TOGETHER_API_KEY)) providers.push("Together");
  if (has(process.env.OPENROUTER_API_KEY)) providers.push("OpenRouter");
  if (has(process.env.ANTHROPIC_API_KEY)) providers.push("Claude/Anthropic (last)");
  return providers;
}

function hasAnyAiProvider(): boolean {
  return configuredAiProviders().length > 0;
}

function aiProviderDetail(): string {
  const providers = configuredAiProviders();
  if (providers.length === 0) {
    return "No AI provider key set. Configure at least one of OPENAI_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY, DEEPSEEK_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY, OPENROUTER_API_KEY, or ANTHROPIC_API_KEY. Without any AI key, complex PDFs fall back to weaker regex extraction and imported records remain REGEX_DRAFT.";
  }
  const extractionNote = has(process.env.GEMINI_API_KEY)
    ? "Gemini analysis/extraction is configured."
    : "Gemini analysis/extraction is not configured; analysis may use later fallbacks and can degrade to regex if providers fail.";
  return `Configured providers in default proposal order: ${providers.join(" → ")}. ${extractionNote} Claude/Anthropic is intentionally last.`;
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
      title: "AI provider chain",
      // OK when any supported provider is configured. The default proposal and
      // validation chain is OpenAI → Gemini → Mistral → DeepSeek → Groq → Together → OpenRouter →
      // Claude, while analysis/extraction starts with Gemini. Claude remains
      // last so Anthropic rate limits cannot block the app when earlier
      // providers are available.
      severity: hasAnyAiProvider() ? "OK" : "CRITICAL",
      requiredForProduction: true,
      detail: aiProviderDetail(),
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
