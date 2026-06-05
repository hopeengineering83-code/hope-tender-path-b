/**
 * Safe JSON helpers — never throw.
 * Use these instead of bare JSON.parse in server components and API routes
 * so a single malformed DB field cannot crash the entire page.
 */

export function safeParseJsonArray<T = unknown>(
  value: string | null | undefined,
  fallback: T[] = [],
): T[] {
  if (!value || value.trim() === "") return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

export function safeParseJsonObject<T extends Record<string, unknown> = Record<string, unknown>>(
  value: string | null | undefined,
  fallback: T = {} as T,
): T {
  if (!value || value.trim() === "") return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as T)
      : fallback;
  } catch {
    return fallback;
  }
}
