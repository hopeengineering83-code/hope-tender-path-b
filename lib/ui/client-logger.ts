/**
 * Browser-safe logger for client components.
 *
 * In production, this is a no-op (errors are silently swallowed to avoid
 * leaking internal details to the browser console). In development, it
 * passes through to console for debugging.
 *
 * Server-side code should use lib/observability.ts instead.
 */

const isDev = process.env.NODE_ENV !== "production";

export const clientLogger = {
  error: (msg: string, context?: Record<string, unknown>) => {
    if (isDev) {
      // eslint-disable-next-line no-console
      console.error(`[client] ${msg}`, context ?? "");
    }
  },
  warn: (msg: string, context?: Record<string, unknown>) => {
    if (isDev) {
      // eslint-disable-next-line no-console
      console.warn(`[client] ${msg}`, context ?? "");
    }
  },
  info: (msg: string, context?: Record<string, unknown>) => {
    if (isDev) {
      // eslint-disable-next-line no-console
      console.info(`[client] ${msg}`, context ?? "");
    }
  },
};
