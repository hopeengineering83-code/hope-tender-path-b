// ─── Provider failure classification — the single authority ──────────────────
//
// Every provider adapter, diagnostic, health surface and retry decision derives
// its failure category from THIS module. There is exactly one ordered set of
// rules, so a given provider response cannot be called BILLING in one place and
// RATE_LIMIT in another.
//
// Why the order below is the way it is
// ────────────────────────────────────
// The rules are evaluated in a fixed sequence, and the sequence is the design.
// Billing is checked BEFORE rate limiting because the two share vocabulary and
// only billing is unrecoverable without spending money:
//
//   Cerebras exhausted free tier → HTTP 402, body says "…free tier quota…".
//   OpenAI exhausted paid credit → HTTP 429, body says "insufficient_quota".
//   Gemini hit its per-minute cap → HTTP 429, body says "Quota exceeded for
//                                   quota metric '…requests per minute'".
//
// A classifier that matches the bare word `quota` first calls all three
// RATE_LIMIT. That was the live defect: Cerebras' 402 was recorded as a rate
// limit, so the chain kept re-attempting a provider that could only ever answer
// "pay us", burning attempt budget on every analysis and — on an account with a
// card attached — risking real charges. Billing signals are therefore matched
// on billing-specific PHRASES (`insufficient quota`, `exceeded your current
// quota`, `payment required`, `credit balance`), never on `quota` alone, so
// Gemini's genuinely-transient per-minute cap is still RATE_LIMIT.
//
// HTTP status is extracted from anchored patterns (`HTTP 402`, `status: 402`)
// rather than by scanning for a bare three-digit number, because provider error
// bodies routinely contain unrelated digits.

export type AiProviderFailureCategory =
  | "RATE_LIMIT"
  | "AUTH"
  | "BILLING"
  | "TIMEOUT"
  | "MODEL_UNAVAILABLE"
  | "NETWORK"
  | "MALFORMED_RESPONSE"
  | "CONFIGURATION_INVALID"
  // The provider is up and authenticated but temporarily has no capacity —
  // Anthropic 529 "overloaded_error", Gemini "The model is overloaded",
  // OpenAI "server is overloaded". Distinct from RATE_LIMIT (our usage is the
  // problem) and from PROVIDER_ERROR (their software broke): nothing is wrong
  // with the request, so a short backoff and the same call will work.
  | "PROVIDER_OVERLOAD"
  // The provider accepted the request and then failed on its own side (5xx).
  | "PROVIDER_ERROR"
  | "UNKNOWN";

/** Categories that mean "this provider wants money before it will answer". */
export const BILLING_CATEGORIES: ReadonlySet<AiProviderFailureCategory> = new Set(["BILLING"]);

/**
 * Categories that describe the PROVIDER or its CONFIGURATION rather than the
 * tender being analysed. Every one of them can be cleared by an operator
 * changing keys, models or plans — none of them says anything about whether the
 * source document is still analysable. Used by the AI Analyze retry path to
 * decide that a stale failure must not permanently block a fresh manual retry.
 */
export const PROVIDER_CLASS_CATEGORIES: ReadonlySet<AiProviderFailureCategory> = new Set([
  "RATE_LIMIT",
  "AUTH",
  "BILLING",
  "TIMEOUT",
  "MODEL_UNAVAILABLE",
  "NETWORK",
  "CONFIGURATION_INVALID",
  "PROVIDER_OVERLOAD",
  "PROVIDER_ERROR",
]);

/**
 * Pull an HTTP status out of an error message. Anchored to the shapes adapters
 * and SDKs actually produce, so a `402` appearing inside a quoted tender
 * snippet or a request id is never mistaken for a status code.
 */
export function extractHttpStatus(message: string): number | null {
  const patterns = [
    /\bhttp\s*(?:status\s*)?(?:code\s*)?[:=]?\s*(\d{3})\b/i,
    /\bstatus(?:\s*code)?\s*[:=]\s*"?(\d{3})"?/i,
    /\b(\d{3})\s+(?:payment\s+required|too\s+many\s+requests|unauthorized|forbidden|not\s+found)\b/i,
    /\bresponded\s+with\s+(?:status\s+)?(\d{3})\b/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      const status = Number(match[1]);
      if (status >= 100 && status <= 599) return status;
    }
  }
  return null;
}

// ─── Signal vocabularies ─────────────────────────────────────────────────────
// Each list is phrase-based. Single ambiguous words (`quota`, `limit`, `key`)
// are deliberately absent: they are the reason the previous classifier
// mis-sorted three different failures into one bucket.

// Billing: the account cannot pay. Never transient, never worth an automatic
// retry, and on the zero-paid configuration never worth an attempt at all.
const BILLING_PHRASES = [
  "payment required",
  "insufficient balance",
  "insufficient_balance",
  "insufficient quota",
  "insufficient_quota",
  "exceeded your current quota",
  "billing details",
  "billing hard limit",
  "credit balance is too low",
  "account balance",
  "add a payment method",
  "add credits",
  "no credits remaining",
  "requires payment",
  "upgrade your plan",
  "purchase more credits",
  "free tier quota", // Cerebras 402 wording — exhausted free allowance, pay to continue
  "spending limit",
  "payment_required",
  "billing_not_active",
];

// Auth: the credential is wrong, missing or revoked. Phrase-based so a body
// that merely mentions "api key" in prose is not called AUTH.
const AUTH_PHRASES = [
  "invalid api key",
  "invalid_api_key",
  "incorrect api key",
  "api key not valid",
  "api key is invalid",
  "invalid authentication",
  "authentication_error",
  "authentication failed",
  "unauthenticated",
  "unauthorized",
  "invalid token",
  "invalid_request_error: invalid",
  "permission denied",
  "forbidden",
  "no auth credentials",
  "missing api key",
  "api key expired",
];

// Rate limit: our request rate or token throughput is capped, right now.
// Includes Gemini's RESOURCE_EXHAUSTED / per-minute quota-metric wording, which
// is genuinely transient despite containing the word "quota".
const RATE_LIMIT_PHRASES = [
  "rate limit",
  "rate_limit",
  "ratelimit",
  "too many requests",
  "resource has been exhausted",
  "resource_exhausted",
  "requests per minute",
  "tokens per minute",
  "requests per day",
  "tokens per day",
  "quota exceeded for quota metric",
  // Bare "quota exceeded", reached only AFTER every billing-specific phrase has
  // been ruled out above. At that point a throughput cap is both the likelier
  // reading and by far the safer one: calling it RATE_LIMIT costs a short
  // backoff if we are wrong, while calling it BILLING would permanently lock a
  // working free provider out of the chain. Gemini's free-tier cap says
  // literally "Quota exceeded for quota metric '…requests per minute'", so the
  // dangerous direction is the one that treats this phrase as unpayable.
  "quota exceeded",
  "per-minute",
  "rpm limit",
  "tpm limit",
  "slow down",
  "try again in",
];

// Overload: the provider is up but has no capacity for anyone right now.
const OVERLOAD_PHRASES = [
  "overloaded",
  "overloaded_error",
  "is currently overloaded",
  "at capacity",
  "capacity constraints",
  "server is busy",
  "engine is currently overloaded",
  "model is currently loading",
  "temporarily unable to process",
  "please retry shortly",
  "no capacity",
];

// Model unavailable: the identifier we asked for is not something this account
// can call — wrong name, retired snapshot, or not entitled.
const MODEL_UNAVAILABLE_PHRASES = [
  "model not found",
  "model_not_found",
  "unknown model",
  "does not exist or you do not have access",
  "no such model",
  "model unavailable",
  "model is not supported",
  "model has been deprecated",
  "has been decommissioned",
  "is decommissioned",
  "not available for your",
  "please check the model",
  "invalid model",
  "unsupported model",
];

const TIMEOUT_PHRASES = ["timed out", "timeout", "etimedout", "aborted", "abort", "deadline exceeded"];

const NETWORK_PHRASES = [
  "fetch failed",
  "econnreset",
  "econnrefused",
  "enotfound",
  "getaddrinfo",
  "socket hang up",
  "network error",
  "dns lookup",
  "tls",
  "certificate",
];

const MALFORMED_PHRASES = [
  "no json",
  "malformed json",
  "invalid json",
  "json parse",
  "unexpected token",
  "structured output missing",
  "no json found",
  "empty response",
];

const PROVIDER_ERROR_PHRASES = [
  "internal server error",
  "bad gateway",
  "service unavailable",
  "gateway timeout",
  "internal error",
  "api_error",
];

function containsAny(haystack: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => haystack.includes(phrase));
}

export type ClassifiableError = {
  /** HTTP status when the caller already knows it — always preferred over parsing. */
  status?: number | null;
  /** Provider-supplied machine code, e.g. OpenAI's `insufficient_quota`. */
  code?: string | null;
  message?: string | null;
};

function normalize(error: unknown): { text: string; status: number | null } {
  if (error && typeof error === "object" && !(error instanceof Error)) {
    const candidate = error as ClassifiableError;
    const hasShape =
      "status" in candidate || "code" in candidate || "message" in candidate;
    if (hasShape) {
      const text = `${candidate.code ?? ""} ${candidate.message ?? ""}`.toLowerCase();
      const status =
        typeof candidate.status === "number" && Number.isFinite(candidate.status)
          ? candidate.status
          : extractHttpStatus(text);
      return { text, status };
    }
  }
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const text = raw.toLowerCase();
  return { text, status: extractHttpStatus(text) };
}

/**
 * Classify a provider failure into exactly one category.
 *
 * Accepts a raw Error, a string, or a `{ status, code, message }` shape when the
 * caller already parsed the response. Structured input is preferred: it removes
 * any dependence on how an adapter happened to phrase its thrown message.
 */
export function classifyProviderError(error: unknown): AiProviderFailureCategory {
  const { text, status } = normalize(error);

  // 1. BILLING — before anything status-based, because OpenAI reports an
  //    unpayable account as 429 and Cerebras reports it as 402. The phrase is
  //    authoritative; the status is not.
  if (containsAny(text, BILLING_PHRASES)) return "BILLING";
  if (status === 402) return "BILLING";

  // 2. AUTH — a wrong credential. Checked before rate limiting because some
  //    providers answer a revoked key with a throttling-flavoured message.
  if (containsAny(text, AUTH_PHRASES)) return "AUTH";
  if (status === 401 || status === 403) return "AUTH";

  // 3. RATE_LIMIT — a true throughput cap, including Gemini's quota-metric
  //    wording. Reached only after billing has been ruled out.
  if (containsAny(text, RATE_LIMIT_PHRASES)) return "RATE_LIMIT";
  if (status === 429) return "RATE_LIMIT";

  // 4. PROVIDER_OVERLOAD — capacity, not our usage. 529 is Anthropic's.
  if (containsAny(text, OVERLOAD_PHRASES)) return "PROVIDER_OVERLOAD";
  if (status === 529) return "PROVIDER_OVERLOAD";

  // 5. MODEL_UNAVAILABLE — the identifier is wrong or not entitled.
  if (containsAny(text, MODEL_UNAVAILABLE_PHRASES)) return "MODEL_UNAVAILABLE";
  if (status === 404) return "MODEL_UNAVAILABLE";

  // 6. TIMEOUT and 7. NETWORK — kept separate: a timeout means they were
  //    reached and were too slow, a network error means they were never reached.
  if (containsAny(text, TIMEOUT_PHRASES)) return "TIMEOUT";
  if (containsAny(text, NETWORK_PHRASES)) return "NETWORK";

  // 8. MALFORMED_RESPONSE — they answered, the answer was unusable.
  if (containsAny(text, MALFORMED_PHRASES)) return "MALFORMED_RESPONSE";

  // 9. PROVIDER_ERROR — their software broke. Last, so a 503 that also says
  //    "rate limit" is still RATE_LIMIT.
  if (containsAny(text, PROVIDER_ERROR_PHRASES)) return "PROVIDER_ERROR";
  if (status !== null && status >= 500 && status <= 599) return "PROVIDER_ERROR";

  return "UNKNOWN";
}

/** True when the category means the provider is demanding payment. */
export function isBillingBlocked(category: AiProviderFailureCategory | null | undefined): boolean {
  return category != null && BILLING_CATEGORIES.has(category);
}

/** True when the category describes the provider/config rather than the source document. */
export function isProviderClassFailure(category: string | null | undefined): boolean {
  return category != null && PROVIDER_CLASS_CATEGORIES.has(category as AiProviderFailureCategory);
}
