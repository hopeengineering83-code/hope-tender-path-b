export type AIEnvironmentVariableStatus = {
  name: string;
  present: boolean;
  scope: "ai" | "database" | "auth" | "ocr" | "runtime";
  severity: "critical" | "recommended" | "optional";
  note: string;
};

export type AIEnvironmentReadiness = {
  ready: boolean;
  providerChain: string[];
  variables: AIEnvironmentVariableStatus[];
  blockers: string[];
  warnings: string[];
};

function present(name: string): boolean {
  return Boolean((process.env[name] ?? "").trim());
}

function status(name: string, scope: AIEnvironmentVariableStatus["scope"], severity: AIEnvironmentVariableStatus["severity"], note: string): AIEnvironmentVariableStatus {
  return { name, present: present(name), scope, severity, note };
}

export function getAIEnvironmentReadiness(): AIEnvironmentReadiness {
  const variables: AIEnvironmentVariableStatus[] = [
    status("ANTHROPIC_API_KEY", "ai", "recommended", "Last-resort provider (sixth in default chain). Placed last to avoid Anthropic rate limits blocking the app when other providers are available."),
    status("ANTHROPIC_TIER", "ai", "recommended", "Used to select Claude output-token defaults; Tier 2 supports larger proposal outputs than Tier 1."),
    status("ANTHROPIC_MAX_OUTPUT_TOKENS", "ai", "recommended", "Controls Claude proposal output budget. Use a realistic value for your Vercel timeout and Anthropic tier."),
    status("ANTHROPIC_PROPOSAL_MODELS", "ai", "recommended", "Comma-separated Claude model chain for proposal generation."),
    status("GEMINI_API_KEY", "ai", "critical", "Gemini analysis/extraction primary and second-tier proposal fallback provider."),
    status("GEMINI_MODEL", "ai", "recommended", "Default Gemini model for general AI calls."),
    status("GEMINI_ANALYSIS_MODEL", "ai", "recommended", "Gemini model for tender analysis when configured."),
    status("GEMINI_EXTRACTION_MODEL", "ai", "recommended", "Gemini model for company knowledge extraction when configured."),
    status("GEMINI_FALLBACK_MODELS", "ai", "recommended", "Fallback Gemini model chain."),
    status("OPENAI_API_KEY", "ai", "critical", "First-tier provider for proposal generation, validation, and default chain."),
    status("OPENAI_PROPOSAL_MODEL", "ai", "optional", "OpenAI proposal model (default: gpt-4o)."),
    status("DEEPSEEK_API_KEY", "ai", "optional", "Third-tier fallback provider via OpenAI-compatible DeepSeek endpoint."),
    status("DEEPSEEK_PROPOSAL_MODEL", "ai", "optional", "DeepSeek proposal model (default: deepseek-chat; deepseek-reasoner for deeper reasoning)."),
    status("GROQ_API_KEY", "ai", "optional", "Fourth-tier fallback provider; also first in the fast/cheap use-case chain (llama-3.3-70b-versatile)."),
    status("GROQ_PROPOSAL_MODEL", "ai", "optional", "Groq model override (default: llama-3.3-70b-versatile)."),
    status("OPENROUTER_API_KEY", "ai", "optional", "Fifth-tier fallback provider; aggregates many models via OpenAI-compatible API."),
    status("OPENROUTER_PROPOSAL_MODEL", "ai", "optional", "OpenRouter model pin (default: openrouter/auto — pin to a specific model for predictable costs)."),
    status("PDF_OCR_ENABLED", "ocr", "recommended", "Enables OCR path for scanned/image-heavy PDFs."),
    status("PDF_OCR_MODEL", "ocr", "recommended", "OCR reasoning model selector."),
    status("PDF_OCR_MAX_PAGES", "ocr", "recommended", "Caps OCR pages to avoid serverless timeout/cost overrun."),
    status("PDF_OCR_MAX_RACES", "ocr", "optional", "Optional OCR race/concurrency guard. Recommended production value: 1 for conservative Vercel OCR behavior."),
    status("DATABASE_URL", "database", "critical", "Persistent database connection."),
    status("SESSION_SECRET", "auth", "critical", "Required for secure login/session cookies."),
    status("AI_ANALYSIS_TIMEOUT_MS", "runtime", "recommended", "Tender-analysis timeout guard."),
    status("AI_PROPOSAL_TIMEOUT_MS", "runtime", "recommended", "Proposal-generation timeout guard."),
    status("PROPOSAL_SECTION_TIMEOUT_MS", "runtime", "recommended", "Section-level proposal timeout guard."),
  ];

  // Reflect actual PROVIDER_CHAINS order: OpenAI → Gemini → DeepSeek → Groq → OpenRouter → Claude
  const providerChain: string[] = [];
  if (present("OPENAI_API_KEY")) providerChain.push(`OpenAI (${process.env.OPENAI_PROPOSAL_MODEL || "gpt-4o"})`);
  if (present("GEMINI_API_KEY")) providerChain.push(`Gemini (${process.env.GEMINI_MODEL || "gemini-2.5-pro"})`);
  if (present("DEEPSEEK_API_KEY")) providerChain.push(`DeepSeek (${process.env.DEEPSEEK_PROPOSAL_MODEL || "deepseek-chat"})`);
  if (present("GROQ_API_KEY")) providerChain.push(`Groq (${process.env.GROQ_PROPOSAL_MODEL || "llama-3.3-70b-versatile"})`);
  if (present("OPENROUTER_API_KEY")) providerChain.push(`OpenRouter (${process.env.OPENROUTER_PROPOSAL_MODEL || "auto"})`);
  if (present("ANTHROPIC_API_KEY")) providerChain.push("Claude (last-resort)");

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!present("OPENAI_API_KEY") && !present("GEMINI_API_KEY") && !present("ANTHROPIC_API_KEY") && !present("DEEPSEEK_API_KEY") && !present("GROQ_API_KEY") && !present("OPENROUTER_API_KEY")) {
    blockers.push("No AI provider is configured. Set at least one of: OPENAI_API_KEY, GEMINI_API_KEY, DEEPSEEK_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, or ANTHROPIC_API_KEY.");
  }
  if (!present("DATABASE_URL")) blockers.push("DATABASE_URL is missing.");
  if (!present("SESSION_SECRET")) blockers.push("SESSION_SECRET is missing.");
  if (!present("PDF_OCR_ENABLED")) warnings.push("PDF_OCR_ENABLED is not set. Scanned PDFs may extract poorly unless OCR defaults are enabled elsewhere.");
  if (!present("PDF_OCR_MAX_RACES")) warnings.push("PDF_OCR_MAX_RACES is not set. Recommended value: 1 to keep OCR provider races/concurrency conservative on Vercel.");
  if (!present("ANTHROPIC_TIER") && present("ANTHROPIC_API_KEY")) warnings.push("ANTHROPIC_TIER is not set. Claude output-token defaults may not match your Tier 2 account.");

  return {
    ready: blockers.length === 0,
    providerChain,
    variables,
    blockers,
    warnings,
  };
}
