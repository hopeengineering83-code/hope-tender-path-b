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
    status("MISTRAL_API_KEY", "ai", "critical", "First-tier provider in the canonical chain (Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Claude). Verified working; used for analysis, extraction, proposal, validation."),
    status("MISTRAL_PROPOSAL_MODEL", "ai", "optional", "Mistral proposal model (default: mistral-large-latest)."),
    status("MISTRAL_ANALYSIS_MODEL", "ai", "optional", "Mistral analysis model override."),
    status("MISTRAL_FAST_MODEL", "ai", "optional", "Mistral fast/cheap model override."),
    status("GROQ_API_KEY", "ai", "critical", "Second-tier provider — fastest verified working provider. Uses llama-3.3-70b-versatile by default."),
    status("GROQ_PROPOSAL_MODEL", "ai", "optional", "Groq model override (default: llama-3.3-70b-versatile)."),
    status("OPENROUTER_API_KEY", "ai", "critical", "Third-tier aggregator provider — routes via high-quality models via OpenAI-compatible API."),
    status("OPENROUTER_PROPOSAL_MODEL", "ai", "optional", "OpenRouter model pin (default: openrouter/auto — pin to a specific model for predictable costs)."),
    status("GEMINI_API_KEY", "ai", "critical", "Fourth-tier provider in the canonical chain for analysis, extraction, proposal, validation, and fast use cases."),
    status("GEMINI_MODEL", "ai", "recommended", "Default Gemini model for general AI calls."),
    status("GEMINI_ANALYSIS_MODEL", "ai", "recommended", "Gemini model for tender analysis when configured."),
    status("GEMINI_EXTRACTION_MODEL", "ai", "recommended", "Gemini model for company knowledge extraction when configured."),
    status("GEMINI_FALLBACK_MODELS", "ai", "recommended", "Fallback Gemini model chain."),
    status("OPENAI_API_KEY", "ai", "critical", "Fifth-tier provider in the canonical chain."),
    status("OPENAI_PROPOSAL_MODEL", "ai", "optional", "OpenAI proposal model (default: gpt-4o)."),
    status("TOGETHER_API_KEY", "ai", "optional", "Sixth-tier fallback provider via OpenAI-compatible Together endpoint."),
    status("TOGETHER_PROPOSAL_MODEL", "ai", "optional", "Together proposal model override."),
    status("TOGETHER_ANALYSIS_MODEL", "ai", "optional", "Together analysis model override."),
    status("TOGETHER_FAST_MODEL", "ai", "optional", "Together fast/cheap model override."),
    status("DEEPSEEK_API_KEY", "ai", "optional", "Seventh-tier fallback provider via OpenAI-compatible DeepSeek endpoint."),
    status("DEEPSEEK_PROPOSAL_MODEL", "ai", "optional", "DeepSeek proposal model (default: deepseek-chat; deepseek-reasoner for deeper reasoning)."),
    status("ANTHROPIC_API_KEY", "ai", "recommended", "Last-resort provider (eighth in default chain). Placed last to avoid Anthropic rate limits blocking the app when other providers are available."),
    status("ANTHROPIC_TIER", "ai", "recommended", "Used to select Claude output-token defaults; Tier 2 supports larger proposal outputs than Tier 1."),
    status("ANTHROPIC_MAX_OUTPUT_TOKENS", "ai", "recommended", "Controls Claude proposal output budget. Use a realistic value for your Vercel timeout and Anthropic tier."),
    status("ANTHROPIC_PROPOSAL_MODELS", "ai", "recommended", "Comma-separated Claude model chain for proposal generation."),
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

  // Reflect the required canonical provider order: Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Claude
  const providerChain: string[] = [];
  if (present("MISTRAL_API_KEY")) providerChain.push(`Mistral (${process.env.MISTRAL_PROPOSAL_MODEL || "mistral-large-latest"})`);
  if (present("GROQ_API_KEY")) providerChain.push(`Groq (${process.env.GROQ_PROPOSAL_MODEL || "llama-3.3-70b-versatile"})`);
  if (present("OPENROUTER_API_KEY")) providerChain.push(`OpenRouter (${process.env.OPENROUTER_PROPOSAL_MODEL || "auto"})`);
  if (present("GEMINI_API_KEY")) providerChain.push(`Gemini (${process.env.GEMINI_MODEL || "gemini-2.5-pro"})`);
  if (present("OPENAI_API_KEY")) providerChain.push(`OpenAI (${process.env.OPENAI_PROPOSAL_MODEL || "gpt-4o"})`);
  if (present("TOGETHER_API_KEY")) providerChain.push(`Together (${process.env.TOGETHER_PROPOSAL_MODEL || "meta-llama/Llama-3-70b-chat-hf"})`);
  if (present("DEEPSEEK_API_KEY")) providerChain.push(`DeepSeek (${process.env.DEEPSEEK_PROPOSAL_MODEL || "deepseek-chat"})`);
  if (present("ANTHROPIC_API_KEY")) providerChain.push("Claude (last-resort)");

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!present("OPENAI_API_KEY") && !present("GEMINI_API_KEY") && !present("ANTHROPIC_API_KEY") && !present("MISTRAL_API_KEY") && !present("DEEPSEEK_API_KEY") && !present("GROQ_API_KEY") && !present("TOGETHER_API_KEY") && !present("OPENROUTER_API_KEY")) {
    blockers.push("No AI provider is configured. Set at least one of: OPENAI_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY, DEEPSEEK_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY, OPENROUTER_API_KEY, or ANTHROPIC_API_KEY.");
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
