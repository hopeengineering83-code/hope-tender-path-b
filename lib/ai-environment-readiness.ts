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
    status("ANTHROPIC_API_KEY", "ai", "critical", "Primary Claude provider for deep proposal generation, extraction fallback, OCR reasoning, and long-form refinement."),
    status("ANTHROPIC_TIER", "ai", "recommended", "Used to select Claude output-token defaults; Tier 2 supports larger proposal outputs than Tier 1."),
    status("ANTHROPIC_MAX_OUTPUT_TOKENS", "ai", "recommended", "Controls Claude proposal output budget. Use a realistic value for your Vercel timeout and Anthropic tier."),
    status("ANTHROPIC_PROPOSAL_MODELS", "ai", "recommended", "Comma-separated Claude model chain for proposal generation."),
    status("GEMINI_API_KEY", "ai", "critical", "Gemini fallback provider and fast analysis/extraction model."),
    status("GEMINI_MODEL", "ai", "recommended", "Default Gemini model for general AI calls."),
    status("GEMINI_ANALYSIS_MODEL", "ai", "recommended", "Gemini model for tender analysis when configured."),
    status("GEMINI_EXTRACTION_MODEL", "ai", "recommended", "Gemini model for company knowledge extraction when configured."),
    status("GEMINI_FALLBACK_MODELS", "ai", "recommended", "Fallback Gemini model chain."),
    status("OPENAI_API_KEY", "ai", "recommended", "Third-tier fallback provider for proposal generation across all proposal paths."),
    status("OPENAI_PROPOSAL_MODEL", "ai", "optional", "OpenAI proposal model (default: gpt-4o)."),
    status("DEEPSEEK_API_KEY", "ai", "optional", "Fourth-tier fallback provider via OpenAI-compatible DeepSeek endpoint."),
    status("DEEPSEEK_PROPOSAL_MODEL", "ai", "optional", "DeepSeek proposal model (default: deepseek-chat; deepseek-reasoner for deeper reasoning)."),
    status("PDF_OCR_ENABLED", "ocr", "recommended", "Enables OCR path for scanned/image-heavy PDFs."),
    status("PDF_OCR_MODEL", "ocr", "recommended", "OCR reasoning model selector."),
    status("PDF_OCR_MAX_PAGES", "ocr", "recommended", "Caps OCR pages to avoid serverless timeout/cost overrun."),
    status("PDF_OCR_MAX_RACES", "ocr", "optional", "Controls OCR concurrency/race settings if supported by extraction code."),
    status("DATABASE_URL", "database", "critical", "Persistent database connection."),
    status("SESSION_SECRET", "auth", "critical", "Required for secure login/session cookies."),
    status("AI_ANALYSIS_TIMEOUT_MS", "runtime", "recommended", "Tender-analysis timeout guard."),
    status("AI_PROPOSAL_TIMEOUT_MS", "runtime", "recommended", "Proposal-generation timeout guard."),
    status("PROPOSAL_SECTION_TIMEOUT_MS", "runtime", "recommended", "Section-level proposal timeout guard."),
  ];

  const providerChain: string[] = [];
  if (present("ANTHROPIC_API_KEY")) providerChain.push("Claude");
  if (present("GEMINI_API_KEY")) providerChain.push("Gemini");
  if (present("OPENAI_API_KEY")) providerChain.push("OpenAI");
  if (present("DEEPSEEK_API_KEY")) providerChain.push(`DeepSeek (${process.env.DEEPSEEK_PROPOSAL_MODEL || "deepseek-chat"})`);

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!present("ANTHROPIC_API_KEY") && !present("GEMINI_API_KEY") && !present("OPENAI_API_KEY") && !present("DEEPSEEK_API_KEY")) {
    blockers.push("No AI provider is configured. Set at least one of: ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, or DEEPSEEK_API_KEY.");
  }
  if (!present("DATABASE_URL")) blockers.push("DATABASE_URL is missing.");
  if (!present("SESSION_SECRET")) blockers.push("SESSION_SECRET is missing.");
  if (!present("PDF_OCR_ENABLED")) warnings.push("PDF_OCR_ENABLED is not set. Scanned PDFs may extract poorly unless OCR defaults are enabled elsewhere.");
  if (!present("ANTHROPIC_TIER") && present("ANTHROPIC_API_KEY")) warnings.push("ANTHROPIC_TIER is not set. Claude output-token defaults may not match your Tier 2 account.");

  return {
    ready: blockers.length === 0,
    providerChain,
    variables,
    blockers,
    warnings,
  };
}
