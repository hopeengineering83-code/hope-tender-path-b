import { classifyProviderError } from "../../ai-provider-classification";

export type AiProviderFailureCategory =
  | "NOT_CONFIGURED"
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "BILLING_BLOCKED"
  | "MODEL_UNAVAILABLE"
  | "PROVIDER_OVERLOAD"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "COOLING_DOWN"
  | "PROVIDER_EXHAUSTED"
  | "UNKNOWN";

/**
 * Maps raw provider errors to user-safe diagnostic categories.
 *
 * The mapping is DERIVED from the single classifier in
 * lib/ai-provider-classification.ts. It used to be its own ordered ladder, and
 * that ladder tested `429` before it tested billing — so OpenAI, which reports
 * an unpayable account as HTTP 429 with `insufficient_quota`, was shown to the
 * user as a rate limit. Cerebras' 402 matched neither branch and fell through
 * to UNKNOWN. Two different money problems, two different wrong answers.
 *
 * The categories below are this module's own vocabulary — deliberately not the
 * same names as the classifier's, because these are user-facing. What is shared
 * is the DECISION about what the error means, not the label put on it.
 */
export function toSafeAiFailureCategory(error: unknown): AiProviderFailureCategory {
  const msg = error instanceof Error ? error.message : String(error);
  const low = msg.toLowerCase();

  // Two states the shared classifier has no opinion about, because they are
  // facts about OUR chain rather than about a provider's response.
  if (low.includes("not configured") || low.includes("api key missing")) return "NOT_CONFIGURED";
  if (low.includes("cooling down")) return "COOLING_DOWN";
  if (low.includes("exhausted") && (low.includes("provider") || low.includes("all providers"))) return "PROVIDER_EXHAUSTED";
  if (low.includes("all providers failed")) return "PROVIDER_EXHAUSTED";

  switch (classifyProviderError(error)) {
    case "BILLING": return "BILLING_BLOCKED";
    case "AUTH": return "UNAUTHORIZED";
    case "RATE_LIMIT": return "RATE_LIMITED";
    case "PROVIDER_OVERLOAD": return "PROVIDER_OVERLOAD";
    case "MODEL_UNAVAILABLE": return "MODEL_UNAVAILABLE";
    case "TIMEOUT": return "TIMEOUT";
    case "NETWORK": return "NETWORK_ERROR";
    // MALFORMED_RESPONSE, CONFIGURATION_INVALID, PROVIDER_ERROR and UNKNOWN have
    // no distinct user-facing category here; they are all "something went wrong
    // that is not about your keys or your usage".
    default: return "UNKNOWN";
  }
}
