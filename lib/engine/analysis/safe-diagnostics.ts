export type AiProviderFailureCategory =
  | "NOT_CONFIGURED"
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "BILLING_BLOCKED"
  | "MODEL_UNAVAILABLE"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "COOLING_DOWN"
  | "PROVIDER_EXHAUSTED"
  | "UNKNOWN";

/**
 * Maps raw provider errors to user-safe diagnostic categories.
 */
export function toSafeAiFailureCategory(error: unknown): AiProviderFailureCategory {
  const msg = error instanceof Error ? error.message : String(error);
  const low = msg.toLowerCase();

  if (low.includes("not configured") || low.includes("api key missing")) return "NOT_CONFIGURED";
  if (low.includes("rate limit") || low.includes("429")) return "RATE_LIMITED";
  if (low.includes("unauthorized") || low.includes("401") || low.includes("invalid api key")) return "UNAUTHORIZED";
  if (low.includes("billing") || low.includes("quota exceeded")) return "BILLING_BLOCKED";
  if (low.includes("model_not_found") || low.includes("unavailable")) return "MODEL_UNAVAILABLE";
  if (low.includes("timeout") || low.includes("deadline")) return "TIMEOUT";
  if (low.includes("network") || low.includes("econnreset") || low.includes("fetch failed")) return "NETWORK_ERROR";
  if (low.includes("cooling down")) return "COOLING_DOWN";
  if (low.includes("exhausted") || low.includes("all providers failed")) return "PROVIDER_EXHAUSTED";

  return "UNKNOWN";
}
