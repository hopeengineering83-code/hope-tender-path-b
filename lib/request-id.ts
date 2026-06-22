import { AsyncLocalStorage } from "node:async_hooks";

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

// ─── Request-scoped correlation context ───────────────────────────────────
//
// AsyncLocalStorage propagates a value through the async call tree without
// threading it through every function signature. The middleware sets the
// request ID once per inbound request; any logger / error handler / DB
// call downstream can read it via `getCurrentRequestId()` without changes
// to its own call signature.
const requestIdStorage = new AsyncLocalStorage<string>();

/**
 * Run `fn` with `requestId` set as the active request-scoped correlation ID.
 * Downstream code can retrieve it via `getCurrentRequestId()`.
 */
export function withRequestId<T>(requestId: string, fn: () => T): T {
  return requestIdStorage.run(requestId, fn);
}

/**
 * Returns the request-scoped correlation ID for the current async context,
 * or `null` if none has been set (e.g. background tasks, scripts).
 */
export function getCurrentRequestId(): string | null {
  return requestIdStorage.getStore() ?? null;
}
