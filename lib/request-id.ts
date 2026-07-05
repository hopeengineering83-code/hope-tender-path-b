// Request-scoped correlation context — server-only module
// Import only from server-side code (routes, middleware, server components)
// Do NOT import in client components or client-side utilities

let requestIdStorage: any = null;

// Lazy-load AsyncLocalStorage only on the server side
function getStorage() {
  if (requestIdStorage === null && typeof window === 'undefined') {
    try {
      const { AsyncLocalStorage } = require("node:async_hooks") as any;
      requestIdStorage = new (AsyncLocalStorage as any)();
    } catch {
      // Client environment or not available
      requestIdStorage = false;
    }
  }
  return requestIdStorage || null;
}

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

/**
 * Run `fn` with `requestId` set as the active request-scoped correlation ID.
 * Downstream code can retrieve it via `getCurrentRequestId()`.
 * Server-only: do not call from client code.
 */
export function withRequestId<T>(requestId: string, fn: () => T): T {
  const storage = getStorage();
  if (!storage) return fn();
  return storage.run(requestId, fn);
}

/**
 * Returns the request-scoped correlation ID for the current async context,
 * or `null` if none has been set (e.g. background tasks, scripts, or client).
 * Safe to call from both server and client (returns null on client).
 */
export function getCurrentRequestId(): string | null {
  const storage = getStorage();
  if (!storage) return null;
  return storage.getStore() ?? null;
}
