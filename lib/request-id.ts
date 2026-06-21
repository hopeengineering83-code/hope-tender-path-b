import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
export function generateRequestId(): string {
  return crypto.randomUUID();
}

export function extractRequestId(req: Request): string {
  return (
    req.headers.get("x-request-id") ??
    req.headers.get("x-correlation-id") ??
    generateRequestId()
  );
}

// OBS-003 FIX: Request-scoped correlation ID via AsyncLocalStorage.
// This allows any code path (handlers, libs, observability) to access
// the current request ID without threading it through every function param.
const requestIdStorage = new AsyncLocalStorage<string>();
/**
 * Run a function with a request ID in context. All code called within
 * the function (including async callbacks) can retrieve the ID via
 * `getCurrentRequestId()`.
 */
export function withRequestId<T>(requestId: string, fn: () => T): T {
  return requestIdStorage.run(requestId, fn);
}
/**
 * Get the current request ID from AsyncLocalStorage context.
 * Returns null if called outside a `withRequestId` context.
 */
export function getCurrentRequestId(): string | null {
  return requestIdStorage.getStore() ?? null;
}
