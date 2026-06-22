/**
 * Redact credentials and truncate error messages before returning them to
 * the client. Prevents connection strings, API keys, and stack traces from
 * leaking through 500 error responses.
 */
import { getCurrentRequestId } from "./request-id";

export function sanitizeError(input: unknown, maxLength = 200): string {
  const raw = input instanceof Error ? input.message : String(input ?? "Unknown error");
  return raw
    .replace(/postgres(?:ql)?:\/\/[^\s"]+/gi, "postgresql://[redacted]")
    .replace(/(mongodb(?:\+srv)?|mysql|redis):\/\/[^\s"]+/gi, "$1://[redacted]")
    .replace(/sk-[a-zA-Z0-9_-]{10,}/g, "[KEY_REDACTED]")
    .replace(/AIza[a-zA-Z0-9_-]{30,}/g, "[KEY_REDACTED]")
    .replace(/Bearer\s+[a-zA-Z0-9._-]{10,}/gi, "Bearer [REDACTED]")
    .slice(0, maxLength);
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
