/**
 * Redact credentials and truncate error messages before returning them to
 * the client. Prevents connection strings, API keys, and stack traces from
 * leaking through 500 error responses.
 */
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
