/**
 * Redact credentials and truncate error messages before returning them to
 * the client. Prevents connection strings, API keys, and stack traces from
 * leaking through 500 error responses.
 */
import { getCurrentRequestId } from "./request-id";

export function sanitizeError(input: unknown, maxLength = 200): string {
  const raw = input instanceof Error ? input.message : String(input ?? "Unknown error");
  const redacted = raw
    // Redact database connection strings
    .replace(/postgres(?:ql)?:\/\/[^\s"]+/gi, "postgresql://[redacted]")
    .replace(/(mongodb(?:\+srv)?|mysql|redis):\/\/[^\s"]+/gi, "$1://[redacted]")
    // Redact API keys and bearer tokens
    .replace(/sk-[a-zA-Z0-9_-]{10,}/g, "[KEY_REDACTED]")
    .replace(/AIza[a-zA-Z0-9_-]{30,}/g, "[KEY_REDACTED]")
    .replace(/Bearer\s+[a-zA-Z0-9._-]{10,}/gi, "Bearer [REDACTED]")
    // Redact Anthropic keys
    .replace(/ant-[a-zA-Z0-9_-]{20,}/g, "[KEY_REDACTED]")
    // Redact OpenAI keys
    .replace(/org-[a-zA-Z0-9]{20,}/g, "[KEY_REDACTED]")
    .replace(/proj-[a-zA-Z0-9_-]{20,}/g, "[KEY_REDACTED]")
    // Redact GitHub PATs
    .replace(/ghp_[a-zA-Z0-9]{36,}/g, "[KEY_REDACTED]")
    .replace(/github_pat_[a-zA-Z0-9_]{20,}/g, "[KEY_REDACTED]")
    // Redact JWTs
    .replace(/eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]*/g, "[JWT_REDACTED]")
    // Redact Vercel Blob tokens
    .replace(/vercel_blob_[a-zA-Z0-9_-]{20,}/gi, "[KEY_REDACTED]")
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
