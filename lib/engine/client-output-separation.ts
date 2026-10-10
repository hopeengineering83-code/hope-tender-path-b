export const FORBIDDEN_CLIENT_OUTPUT_TERMS = [
  "internal notes", "bid-team", "prompt", "system message", "provider fallback", "model class",
  "database id", "storage path", "source hash", "debug", "stack trace", "reviewer-only",
] as const;

export function findForbiddenClientOutputTerms(text: string): string[] {
  const normalized = text.toLowerCase();
  return FORBIDDEN_CLIENT_OUTPUT_TERMS.filter((term) => normalized.includes(term));
}

export function assertClientOutputSeparated(text: string): { ok: true } | { ok: false; terms: string[] } {
  const terms = findForbiddenClientOutputTerms(text);
  return terms.length ? { ok: false, terms } : { ok: true };
}
