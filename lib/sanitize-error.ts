/**
 * Redact credentials and truncate error messages before returning them to
 * the client. Prevents connection strings, API keys, and stack traces from
 * leaking through 500 error responses.
 */
import { getCurrentRequestId } from "./request-id";

/**
 * Redact only secret patterns (API keys, bearer tokens, connection strings)
 * from a text string. Does NOT truncate, does NOT redact UUIDs/SQL/Prisma
 * invocations — use `sanitizeError()` for full client-facing sanitization.
 *
 * This is the single source of truth for secret redaction regexes. Previous
 * implementations had 5 different variants:
 *   - lib/engine/analysis-state-resolver.ts: /sk-[a-zA-Z0-9-]+/g (weakest — no underscore, no min length)
 *   - lib/engine/provider-health-store.ts: /sk-[a-zA-Z0-9_-]{8,}/g
 *   - lib/ai-analyze-checkpoints.ts: /sk-[a-zA-Z0-9_-]{10,}/g
 *   - app/api/tenders/[id]/ai-analyze/route.ts: /sk-[a-zA-Z0-9_-]{10,}/g + AIza + Bearer
 *   - lib/sanitize-error.ts: (this file's sanitizeError inline)
 *
 * All callers should use this function instead of inline regexes so the
 * redaction patterns cannot diverge.
 */
export function redactSecrets(text: string): string {
  return text
    // OpenAI / Anthropic / Groq sk- keys (min 10 chars after prefix)
    .replace(/sk-[a-zA-Z0-9_-]{8,}/g, "[KEY_REDACTED]")
    // Google AIza keys (min 30 chars)
    .replace(/AIza[a-zA-Z0-9_-]{20,}/g, "[KEY_REDACTED]")
    // Google's NEW-format Gemini keys (AQ...). This module's own comment says
    // every caller must use it "so the redaction patterns cannot diverge" — and
    // they had: lib/ai-provider-health.ts carried this pattern locally while the
    // shared redactor did not, so a new-format Gemini key was redacted on one
    // path and printed verbatim on the other.
    .replace(/\bAQ[a-zA-Z0-9_-]{30,}\b/g, "[KEY_REDACTED]")
    // Bearer tokens
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    // Anthropic ant- keys
    .replace(/ant-[a-zA-Z0-9_-]{20,}/g, "[KEY_REDACTED]")
    // OpenAI org-/proj- keys
    .replace(/org-[a-zA-Z0-9]{20,}/g, "[KEY_REDACTED]")
    .replace(/proj-[a-zA-Z0-9_-]{20,}/g, "[KEY_REDACTED]")
    // Groq gsk_ keys (underscore prefix — not matched by sk- above)
    .replace(/gsk_[a-zA-Z0-9]{30,}/g, "[KEY_REDACTED]")
    // Cerebras csk_ keys (underscore prefix — not matched by sk- above)
    .replace(/csk_[a-zA-Z0-9]{30,}/g, "[KEY_REDACTED]")
    // DeepSeek dsk- keys (real DeepSeek format — not sk-deepseek-)
    .replace(/dsk-[a-zA-Z0-9_-]{30,}/g, "[KEY_REDACTED]")
    // GitHub PATs
    .replace(/ghp_[a-zA-Z0-9]{36,}/g, "[KEY_REDACTED]")
    .replace(/github_pat_[a-zA-Z0-9_]{20,}/g, "[KEY_REDACTED]")
    // JWTs
    .replace(/eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]*/g, "[JWT_REDACTED]")
    // Vercel Blob tokens
    .replace(/vercel_blob_[a-zA-Z0-9_-]{20,}/gi, "[KEY_REDACTED]")
    // Vercel deployment tokens (vcp_*)
    .replace(/vcp_[a-zA-Z0-9_-]{30,}/g, "[KEY_REDACTED]")
    // api_key= / key= query params. The bare `key=` form matters because that is
    // how Google's generative-language API takes credentials, so any URL of
    // theirs that reaches a message or a log carries the key in plain sight.
    .replace(/(\bapi[_-]?key\s*[:=]\s*)[^\s&,;]+/gi, "$1[KEY_REDACTED]")
    .replace(/([?&]key=)[^\s&,;"]+/gi, "$1[KEY_REDACTED]")
    // Database connection strings
    .replace(/postgres(?:ql)?:\/\/[^\s"]+/gi, "postgresql://[redacted]")
    .replace(/(mongodb(?:\+srv)?|mysql|redis):\/\/[^\s"]+/gi, "$1://[redacted]");
}

export function sanitizeError(input: unknown, maxLength = 200): string {
  const raw = input instanceof Error ? input.message : String(input ?? "Unknown error");
  const redacted = redactSecrets(raw)
    // Redact Prisma invocation text
    .replace(/Invalid\s+`prisma\.[^`]+`\s+invocation:\s*\{[^]*?\}\s*$/s, "Database query failed")
    .replace(/Invalid\s+`prisma\.[^`]+`\s+invocation:/gi, "Database query failed:")
    // Redact UUIDs (internal tender/user IDs)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[ID_REDACTED]")
    // Redact PrismaClient error class names
    .replace(/PrismaClient\w*Error/g, "DatabaseError")
    // Redact raw SQL patterns
    .replace(/SELECT\s+.*?\s+FROM\s+\w+/gi, "[SQL_REDACTED]")
    .replace(/INSERT\s+INTO\s+\w+/gi, "[SQL_REDACTED]")
    .replace(/UPDATE\s+\w+\s+SET/gi, "[SQL_REDACTED]");
  // If the redacted message still contains query-like patterns, replace entirely
  if (/where:\s*\{|select:\s*\{|include:\s*\{|orderBy:\s*\{/.test(redacted)) {
    return "Database query failed";
  }
  return redacted.slice(0, maxLength);
}

/**
 * Build a client-facing error response body, automatically attaching the
 * request-scoped correlation ID when one is in context (so the client can
 * quote it back to support without grepping logs). The correlation ID is
 * sourced from AsyncLocalStorage — see lib/request-id.ts.
 *
 *   return NextResponse.json(sanitizeErrorResponse(error), { status: 500 });
 *
 * If `extra` is provided, its fields are merged in. An explicit `requestId`
 * in `extra` wins over the ambient one; if neither is available, the field
 * is omitted (e.g. background jobs, scripts).
 */
export function sanitizeErrorResponse(
  input: unknown,
  extra?: Record<string, unknown>,
): { error: string; requestId?: string } & Record<string, unknown> {
  const body: { error: string; requestId?: string } & Record<string, unknown> = {
    error: sanitizeError(input),
    ...(extra ?? {}),
  };
  const ambientRequestId = getCurrentRequestId();
  if (ambientRequestId && body.requestId === undefined) {
    body.requestId = ambientRequestId;
  }
  return body;
}
