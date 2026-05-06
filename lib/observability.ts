/**
 * Production observability primitives (PR #254).
 *
 * THE GAP
 * Up to PR #253, the codebase used console.log / console.warn /
 * console.error directly across ~40 files. Vercel surfaces those
 * lines in the Logs tab as plain text — searchable, but with no
 * structure for filtering by severity, no request correlation, no
 * latency tracking, no integration with external monitoring. When
 * something goes wrong on a real tender at midnight, the operator
 * has to manually grep through prose log lines.
 *
 * THIS MODULE
 * A thin observability layer that:
 *
 *   1. Produces STRUCTURED JSON log lines (level, msg, requestId,
 *      tags, extra fields). Vercel's log viewer renders them as
 *      collapsible JSON; external aggregators (Datadog, Logtail,
 *      Better Stack) parse them as queryable structured events.
 *
 *   2. Adds a TIMER primitive — wrap any async operation in
 *      `await time("ai.proposal.generate", () => ...)` and the
 *      duration is logged automatically with a `duration_ms` field.
 *
 *   3. Routes ERRORS through a single `reportError()` function that
 *      captures stack + context + tags. If SENTRY_DSN is set, sends
 *      via the Sentry HTTP API (no SDK dependency — direct HTTP POST
 *      avoids bundling the 1MB Sentry SDK). Otherwise logs only.
 *
 *   4. PERFORMANCE METRICS — every timed operation also emits a
 *      `metric` event with `value_ms` so an external system can
 *      compute p50/p95/p99 percentiles. No metrics SDK; just
 *      structured stdout that aggregators parse.
 *
 * NO NEW DEPENDENCIES
 * The whole module is plain TypeScript + native fetch. No Sentry
 * SDK, no Pino, no Winston, no OpenTelemetry — keeps the bundle
 * small and the cold-start fast on Vercel.
 *
 * USAGE
 *
 *   import { logger, time, reportError } from "../lib/observability";
 *
 *   logger.info("Tender uploaded", { tenderId, files: 1 });
 *
 *   const result = await time("ai.proposal.generate", async () => {
 *     return generateProposalSectionsParallel(input);
 *   }, { tenderId });
 *
 *   try {
 *     ...
 *   } catch (err) {
 *     reportError(err, { tenderId, route: "/api/tenders/[id]/generate" });
 *     throw err;
 *   }
 *
 * BACKWARDS COMPAT
 * Existing console.log / console.warn / console.error calls keep
 * working. New code uses logger.* / time / reportError. The
 * transition is gradual — no big-bang rewrite.
 */

// ─── Severity levels ─────────────────────────────────────────────────────

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// LOG_LEVEL env var gates which lines reach stdout. Default "info"
// drops debug noise in production. Operators can set LOG_LEVEL=debug
// to enable detailed tracing.
function activeLevelRank(): number {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
  return LEVEL_RANK[raw] ?? LEVEL_RANK.info;
}

// ─── Structured log emission ─────────────────────────────────────────────

interface LogContext {
  // Common tags surfaced as dedicated fields for easier filtering
  // in log aggregators. All optional; pass whatever's relevant.
  tenderId?: string;
  userId?: string;
  documentId?: string;
  route?: string;
  // Free-form: any other key/value pairs
  [key: string]: unknown;
}

interface LogEvent {
  ts: string;
  level: LogLevel;
  msg: string;
  // Vercel injects x-vercel-id; we don't try to capture per-request
  // IDs from inside logger because that would couple logger to
  // request-handling middleware. Operators correlate via the
  // ts + tenderId fields instead.
  [key: string]: unknown;
}

function emit(level: LogLevel, msg: string, context?: LogContext): void {
  if (LEVEL_RANK[level] < activeLevelRank()) return;

  const event: LogEvent = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(context ?? {}),
  };

  // Use the matching console method so Vercel's log filters still work
  // (level dropdown filters on console.error vs console.warn vs etc.)
  // The body is JSON-stringified so log aggregators parse fields.
  const line = JSON.stringify(event);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level === "debug") console.debug(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, context?: LogContext) => emit("debug", msg, context),
  info: (msg: string, context?: LogContext) => emit("info", msg, context),
  warn: (msg: string, context?: LogContext) => emit("warn", msg, context),
  error: (msg: string, context?: LogContext) => emit("error", msg, context),
};

// ─── Performance timing wrapper ──────────────────────────────────────────

/**
 * Wrap any async operation in `time()` to get automatic latency
 * logging + a metric event.
 *
 *   const result = await time("ai.proposal.generate", async () => {
 *     return generateProposalSectionsParallel(input);
 *   }, { tenderId });
 *
 * Emits:
 *   { level: "info", msg: "ai.proposal.generate", duration_ms: 28432, status: "ok", tenderId }
 *
 * On failure, emits the metric AND re-throws so callers see the error:
 *   { level: "warn", msg: "ai.proposal.generate", duration_ms: 50031, status: "error", error: "...", tenderId }
 */
export async function time<T>(
  metricName: string,
  fn: () => Promise<T>,
  context?: LogContext,
): Promise<T> {
  const t0 = Date.now();
  try {
    const result = await fn();
    const duration_ms = Date.now() - t0;
    emit("info", metricName, { ...context, metric: metricName, duration_ms, status: "ok" });
    return result;
  } catch (err) {
    const duration_ms = Date.now() - t0;
    emit("warn", metricName, {
      ...context,
      metric: metricName,
      duration_ms,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ─── Error reporting ─────────────────────────────────────────────────────

/**
 * Single entry point for unhandled / handled errors.
 *
 * Logs the error with full context AND, if SENTRY_DSN is set, sends
 * an event to Sentry's HTTP store API. We use the bare HTTP API
 * (no SDK) to keep the bundle lean.
 *
 * If SENTRY_DSN is unset, errors only land in stdout / Vercel logs —
 * still queryable, just without the Sentry dashboard.
 */
export async function reportError(
  err: unknown,
  context?: LogContext,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  // 1. Always log locally
  emit("error", "unhandled_error", {
    ...context,
    error: message,
    stack,
  });

  // 2. If Sentry is configured, fire-and-forget POST to Sentry's
  //    /store endpoint. We don't await — error reporting must NEVER
  //    block the request response.
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  try {
    const parsed = parseSentryDsn(dsn);
    if (!parsed) return;
    void postSentryEvent(parsed, message, stack, context);
  } catch {
    // Reporting must never throw — silent failure is correct here.
  }
}

interface SentryDsn {
  publicKey: string;
  host: string;
  projectId: string;
}

function parseSentryDsn(dsn: string): SentryDsn | null {
  // Format: https://PUBLIC_KEY@HOST/PROJECT_ID
  const match = dsn.match(/^https?:\/\/([^@]+)@([^/]+)\/(\d+)$/);
  if (!match) return null;
  return { publicKey: match[1], host: match[2], projectId: match[3] };
}

async function postSentryEvent(
  dsn: SentryDsn,
  message: string,
  stack: string | undefined,
  context: LogContext | undefined,
): Promise<void> {
  // Sentry envelope format — minimal shape that the /envelope endpoint
  // accepts. See https://develop.sentry.dev/sdk/envelopes/
  const eventId = (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID().replace(/-/g, "")
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

  const event = {
    event_id: eventId,
    timestamp: Math.floor(Date.now() / 1000),
    level: "error",
    platform: "node",
    message: { message },
    exception: stack ? {
      values: [{ type: "Error", value: message, stacktrace: { frames: parseStackFrames(stack) } }],
    } : undefined,
    tags: context ? Object.fromEntries(Object.entries(context).filter(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")) : {},
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "production",
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? undefined,
  };

  const envelope = [
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: "event", content_type: "application/json" }),
    JSON.stringify(event),
  ].join("\n");

  const url = `https://${dsn.host}/api/${dsn.projectId}/envelope/`;
  const auth = `Sentry sentry_version=7,sentry_key=${dsn.publicKey},sentry_client=hope-tender/1.0`;

  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth": auth,
    },
    body: envelope,
  }).catch(() => {
    // Sentry HTTP failures don't bubble; we already logged locally.
  });
}

interface StackFrame {
  filename: string;
  function: string;
  lineno?: number;
  colno?: number;
}

function parseStackFrames(stack: string): StackFrame[] {
  // Best-effort node stack parser — enough for Sentry to render the
  // stack. Each line: "    at functionName (file:line:col)"
  const frames: StackFrame[] = [];
  for (const line of stack.split("\n").slice(1, 30)) {
    const match = line.match(/^\s*at\s+(?:(.+?)\s+\()?(.+?)(?::(\d+):(\d+))?\)?$/);
    if (!match) continue;
    frames.push({
      function: match[1] ?? "<anonymous>",
      filename: match[2] ?? "<unknown>",
      lineno: match[3] ? parseInt(match[3], 10) : undefined,
      colno: match[4] ? parseInt(match[4], 10) : undefined,
    });
  }
  return frames;
}

// ─── Convenience: child logger with bound context ────────────────────────

/**
 * Create a logger pre-bound with context fields. Useful when many log
 * lines in a single request share the same tenderId / userId etc.:
 *
 *   const log = childLogger({ tenderId, route: "/api/.../generate" });
 *   log.info("starting");
 *   log.warn("slow", { duration_ms: 12000 });
 *   log.error("failed", { error: msg });
 */
export function childLogger(boundContext: LogContext) {
  return {
    debug: (msg: string, ctx?: LogContext) => emit("debug", msg, { ...boundContext, ...(ctx ?? {}) }),
    info: (msg: string, ctx?: LogContext) => emit("info", msg, { ...boundContext, ...(ctx ?? {}) }),
    warn: (msg: string, ctx?: LogContext) => emit("warn", msg, { ...boundContext, ...(ctx ?? {}) }),
    error: (msg: string, ctx?: LogContext) => emit("error", msg, { ...boundContext, ...(ctx ?? {}) }),
  };
}
