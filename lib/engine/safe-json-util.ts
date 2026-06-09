/**
 * Internal engine helper for safe JSON parsing.
 */

export function safeParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value || value.trim() === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

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
