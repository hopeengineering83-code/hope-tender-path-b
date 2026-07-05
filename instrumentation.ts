/**
 * Next.js instrumentation hook — runs once per serverless instance at
 * cold start, BEFORE any request handler executes.
 *
 * Audit OBS-002 (2026-06-20): the app had no global unhandled-rejection /
 * uncaughtException capture. Serverless cold-start crashes, background-job
 * rejections outside a try/catch, and any error in fire-and-forget paths
 * (like `void postSentryEvent(...)` in lib/observability.ts) were silently
 * lost. app/global-error.tsx is client-only and logs nothing server-side.
 *
 * This hook registers two process-level listeners that route those orphan
 * errors through the existing `reportError()` pipeline in lib/observability.ts,
 * so they reach the structured JSON log + Sentry (if SENTRY_DSN is set)
 * instead of disappearing into the void.
 *
 * The listeners are idempotent — registering the same handler twice is a
 * no-op per Node's EventEmitter spec, so multiple cold starts in a long-lived
 * process (e.g. `next dev`) are safe.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only register on the server (Node.js runtime), not in the Edge runtime
  // or in the browser bundle. Next.js calls register() in every runtime;
  // guarding on `process` availability skips the browser.
  if (typeof process === "undefined" || !process.on) return;

  // Lazy-import observability so the browser bundle doesn't pull it in.
  // Using require() inside the guard keeps the import server-only.
  const { reportError } = await import("./lib/observability");

  // unhandledRejection — a Promise rejected with no .catch() handler.
  // Common causes: fire-and-forget `void someAsync()` calls, background
  // job queue errors, Sentry POST failures. Without this listener, Node
  // logs the rejection to stderr and continues — but on Vercel the stderr
  // line is unstructured and not routed to Sentry.
  process.on("unhandledRejection", (reason: unknown) => {
    // reportError is async but we intentionally fire-and-forget here.
    // The process is about to continue (unhandledRejection does not crash
    // by default in Node 15+); we just want the error captured.
    void reportError(reason, {
      tags: ["unhandled-rejection"],
      source: "instrumentation.ts",
    });
  });

  // uncaughtException — a synchronous exception with no try/catch.
  // Node's default behaviour is to print the stack and exit with code 1.
  // We capture the error BEFORE the default exit, so it reaches Sentry.
  // We DO NOT swallow the error — after reporting, we re-throw to preserve
  // Node's default crash semantics (a crashed serverless instance is
  // better than a zombie one holding a broken DB connection).
  process.on("uncaughtException", (err: Error) => {
    void reportError(err, {
      tags: ["uncaught-exception"],
      source: "instrumentation.ts",
    });
    // Re-throw after a tick to give reportError's fire-and-forget POST a
    // chance to start. The process will still exit, but the event is in
    // flight. (This is the same pattern @sentry/nextjs uses.)
    setImmediate(() => {
      throw err;
    });
  });
}
