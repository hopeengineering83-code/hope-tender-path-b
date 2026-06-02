export type AnalysisFallbackCategory =
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "AUTH_OR_ACCESS"
  | "MODEL_UNAVAILABLE"
  | "MALFORMED_AI_JSON"
  | "ALL_PROVIDERS_EXHAUSTED"
  // Distinct from ALL_PROVIDERS_EXHAUSTED: every configured provider is
  // currently in cooldown after a 429/quota — re-running AI Analyze a few
  // minutes later (without changing any keys) should recover.
  | "AI_PROVIDERS_RATE_LIMITED"
  | "NO_PROVIDER_CONFIGURED"
  | "UNKNOWN_AI_FAILURE";

export type AnalysisFallbackDiagnostics = {
  category: AnalysisFallbackCategory;
  risk: "HIGH";
  message: string;
  nextAction: string;
  retryRecommended: boolean;
};

function cleanMessage(value?: string | null): string {
  return (value ?? "")
    .replace(/sk-[^\s"']{8,}/g, "[REDACTED]")
    .replace(/AIza[A-Za-z0-9_-]{30,}/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]{10,}/gi, "Bearer [REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export function buildAnalysisFallbackDiagnostics(rawError?: string | null): AnalysisFallbackDiagnostics {
  const message = cleanMessage(rawError);
  const lower = message.toLowerCase();

  if (/timed out|timeout|aborted/.test(lower)) {
    return {
      category: "TIMEOUT",
      risk: "HIGH",
      message: message || "AI analysis timed out before a full tender analysis completed.",
      nextAction: "Wait briefly, then re-run AI Analyze. For long tenders, increase AI_ANALYSIS_TIMEOUT_MS or reduce/clean uploaded tender files.",
      retryRecommended: true,
    };
  }
  // The "all providers in cooldown" + bare AI_PROVIDERS_RATE_LIMITED branch
  // MUST come before the singular RATE_LIMIT branch, otherwise the
  // generic "rate limit" regex shadows it.
  if (/all .*providers? .*(rate.?limit|cool|429|quota|cooldown)/.test(lower) || /ai_providers_rate_limited/.test(lower)) {
    return {
      category: "AI_PROVIDERS_RATE_LIMITED",
      risk: "HIGH",
      message: message || "Every configured AI provider is currently rate-limited or in cooldown.",
      nextAction: "Wait for provider cooldowns to expire (a few minutes for 429) and re-run AI Analyze. Do not approve regex fallback as final unless wait is unacceptable.",
      retryRecommended: true,
    };
  }
  if (/429|rate.?limit|quota|resource exhausted|tokens per minute/.test(lower)) {
    return {
      category: "RATE_LIMIT",
      risk: "HIGH",
      message: message || "AI provider rate limit or quota was reached.",
      nextAction: "Wait for provider limits to reset, then re-run AI Analyze. Do not rely on regex fallback for final matching/generation.",
      retryRecommended: true,
    };
  }
  if (/401|403|auth|api key|unauthorized|forbidden|access/.test(lower)) {
    return {
      category: "AUTH_OR_ACCESS",
      risk: "HIGH",
      message: message || "AI provider authentication or model access failed.",
      nextAction: "Check provider API keys, account access, billing, and configured model names in Vercel environment variables, then re-run AI Analyze.",
      retryRecommended: false,
    };
  }
  if (/404|model.*not|not found|not supported|model unavailable|invalid_request/.test(lower)) {
    return {
      category: "MODEL_UNAVAILABLE",
      risk: "HIGH",
      message: message || "Configured AI model is unavailable or not supported.",
      nextAction: "Update model environment variables to supported model IDs, redeploy, then re-run AI Analyze.",
      retryRecommended: false,
    };
  }
  if (/malformed json|no json|json object|json parse/.test(lower)) {
    return {
      category: "MALFORMED_AI_JSON",
      risk: "HIGH",
      message: message || "AI provider returned malformed analysis JSON.",
      nextAction: "Re-run AI Analyze. If repeated, reduce tender noise or split very large scanned/combined files.",
      retryRecommended: true,
    };
  }
  if (/all .*providers.*exhausted|all .*chunked analysis calls failed/.test(lower)) {
    return {
      category: "ALL_PROVIDERS_EXHAUSTED",
      risk: "HIGH",
      message: message || "All configured AI provider attempts failed.",
      nextAction: "Open AI Health, confirm provider keys/limits, then re-run AI Analyze before matching or generation.",
      retryRecommended: true,
    };
  }
  if (/no ai provider configured|no provider configured/.test(lower)) {
    return {
      category: "NO_PROVIDER_CONFIGURED",
      risk: "HIGH",
      message: message || "No AI provider is configured.",
      nextAction: "Set OPENAI_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY, DEEPSEEK_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY, OPENROUTER_API_KEY, or ANTHROPIC_API_KEY in Vercel, redeploy, then run AI Analyze.",
      retryRecommended: false,
    };
  }

  return {
    category: "UNKNOWN_AI_FAILURE",
    risk: "HIGH",
    message: message || "AI analysis failed for an unknown reason.",
    nextAction: "Open Vercel logs and AI Health, then re-run AI Analyze after resolving provider issues.",
    retryRecommended: true,
  };
}

export function formatFallbackDiagnosticsLine(diagnostics: AnalysisFallbackDiagnostics): string {
  return `Analysis fallback diagnostics: ${diagnostics.category}; risk=${diagnostics.risk}; retryRecommended=${diagnostics.retryRecommended ? "yes" : "no"}; nextAction=${diagnostics.nextAction}`;
}
