import { classifyProviderError } from "../ai-provider-classification";
import { redactSecrets } from "../sanitize-error";

export type AnalysisFallbackCategory =
  | "TIMEOUT"
  | "RATE_LIMIT"
  // A provider demanding payment. This category did not exist, so a 402 was
  // reported as RATE_LIMIT and the operator was told to "wait for provider
  // limits to reset" — advice for a condition that never clears. Waiting was
  // the one thing guaranteed not to work.
  | "BILLING_BLOCKED"
  | "PROVIDER_OVERLOAD"
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

// Uses the shared redactor. The three patterns that used to live here were a
// fourth divergent copy, and they covered only sk-, AIza and Bearer — missing
// Groq's gsk_, Cerebras' csk_, DeepSeek's dsk-, and Google's newer AQ format.
// This string is operator-facing, so the gap showed real keys to whoever was
// reading the failure.
function cleanMessage(value?: string | null): string {
  return redactSecrets(value ?? "")
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
  // Billing, rate limit, overload, auth and model-availability are all decided
  // by the single classifier in lib/ai-provider-classification.ts rather than by
  // a second regex ladder here. The ladder matched a bare "quota" before it
  // considered payment at all, so Cerebras' 402 and OpenAI's insufficient_quota
  // both surfaced to the operator as "wait for limits to reset".
  const shared = classifyProviderError(message);
  if (shared === "BILLING") {
    return {
      category: "BILLING_BLOCKED",
      risk: "HIGH",
      message: message || "An AI provider requires payment before it will answer.",
      nextAction: "This provider needs a paid account and is excluded from automatic use. Configure a free provider (GEMINI_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY or ZAI_API_KEY) and re-run AI Analyze. Waiting will not clear this.",
      retryRecommended: false,
    };
  }
  if (shared === "RATE_LIMIT") {
    return {
      category: "RATE_LIMIT",
      risk: "HIGH",
      message: message || "AI provider rate limit was reached.",
      nextAction: "Wait for provider limits to reset, then re-run AI Analyze. Do not rely on regex fallback for final matching/generation.",
      retryRecommended: true,
    };
  }
  if (shared === "PROVIDER_OVERLOAD") {
    return {
      category: "PROVIDER_OVERLOAD",
      risk: "HIGH",
      message: message || "The AI provider is temporarily overloaded.",
      nextAction: "This is provider-side capacity, not your configuration or your usage. Re-run AI Analyze shortly.",
      retryRecommended: true,
    };
  }
  if (shared === "AUTH") {
    return {
      category: "AUTH_OR_ACCESS",
      risk: "HIGH",
      message: message || "AI provider authentication or model access failed.",
      nextAction: "Check provider API keys and configured model names in Vercel environment variables, then re-run AI Analyze.",
      retryRecommended: false,
    };
  }
  if (shared === "MODEL_UNAVAILABLE") {
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
      // Names the FREE keys only. This used to list all ten and state that "All
      // 10 providers are automatic" — so an operator following it would reach
      // for whichever key they had, which is exactly how a paid provider gets
      // configured on a deployment that must never spend money.
      nextAction: "Set a free AI provider key (GEMINI_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY or ZAI_API_KEY) in Vercel, redeploy, then run AI Analyze. Cerebras, OpenAI, Together, DeepSeek and Anthropic require paid access and are excluded from automatic use.",
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
