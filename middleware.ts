import { NextResponse, type NextRequest } from "next/server";
import { evaluateCsrf } from "./lib/security/csrf";
import { getProductionCSP } from "./lib/security/csp";
import { extractRequestId, withRequestId } from "./lib/request-id";

const INTERNAL_GUARD_HEADER = "x-hope-internal-rate-guard";
const GUARDED_AI_ROUTE = /^\/api\/tenders\/[^/?]+\/(ai-analyze|generate)$/;
const REQUEST_ID_HEADER = "x-request-id";
const WORKER_SECRET_HEADER = "x-worker-secret";

/**
 * Detect authenticated server-to-server callers (GitHub Actions drain job,
 * Vercel Cron, internal worker). These callers authenticate via a shared
 * secret header instead of a browser session, so they have no Origin /
 * Referer and would otherwise be rejected by the CSRF origin check.
 *
 * The route handler still re-validates the secret — this ONLY skips the
 * CSRF origin check, it does NOT authenticate the caller.
 */
function isAutomatedCaller(req: NextRequest): boolean {
  // Worker secret (GitHub Actions → /api/ai-jobs/run-next, /api/cron/ai-analyze-retry)
  const workerSecret = process.env.AI_JOBS_WORKER_SECRET;
  const workerHeader = req.headers.get(WORKER_SECRET_HEADER);
  if (workerSecret && workerSecret.length >= 16 && workerHeader && workerHeader === workerSecret) {
    return true;
  }

  // Vercel Cron (Authorization: Bearer ${CRON_SECRET} or VERCEL_CRON_SECRET)
  const cronSecret = process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET;
  if (cronSecret && cronSecret.length >= 16) {
    const authHeader = req.headers.get("authorization") ?? "";
    if (authHeader === `Bearer ${cronSecret}`) return true;
  }

  return false;
}

async function deriveInternalGuardToken(): Promise<string | null> {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) return null;
  const bytes = new TextEncoder().encode(`hope-rate-guard:v1:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function withSecurityHeaders(response: NextResponse): NextResponse {
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Content-Security-Policy", getProductionCSP());
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("X-XSS-Protection", "1; mode=block");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
  }
  return response;
}

/**
 * Stamp every response with the request-scoped correlation ID so clients
 * and operators can trace a single request end-to-end through logs and
 * the x-request-id response header.
 */
function withRequestIdHeader(response: NextResponse, requestId: string): NextResponse {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

/**
 * Propagate the correlation ID downstream to route handlers by setting
 * the x-request-id header on the rewritten/forwarded request. API routes
 * that call `extractRequestId(req)` will see the same ID the middleware
 * generated, so log lines from middleware and route handler share a key.
 */
function withRequestIdDownstream(requestHeaders: Headers, requestId: string): Headers {
  if (!requestHeaders.has(REQUEST_ID_HEADER)) {
    requestHeaders.set(REQUEST_ID_HEADER, requestId);
  }
  return requestHeaders;
}

export async function middleware(req: NextRequest) {
  // 0. Request-scoped correlation ID (OBS-003). Generated once per inbound
  // request, propagated to route handlers via the x-request-id request
  // header, returned to clients via the x-request-id response header, and
  // made available to any code running inside `withRequestId` via
  // `getCurrentRequestId()` (used by the observability logger).
  const requestId = extractRequestId(req as unknown as Request);

  return withRequestId(requestId, async () => {
    // 1. CSRF Protection — skip for authenticated server-to-server callers
    //    (GitHub Actions drain job, Vercel Cron). These carry a shared secret
    //    header and have no browser Origin/Referer, so the origin check would
    //    reject them with HTTP 403 "Invalid request origin." The route handler
    //    still re-validates the secret.
    if (!isAutomatedCaller(req)) {
      const decision = evaluateCsrf({
        method: req.method,
        pathname: req.nextUrl.pathname,
        expectedOrigin: req.nextUrl.origin,
        origin: req.headers.get("origin"),
        referer: req.headers.get("referer"),
        nodeEnv: process.env.NODE_ENV,
        csrfMode: process.env.CSRF_MODE,
        csrfStrictDev: process.env.CSRF_STRICT_DEV,
      });

      if (!decision.allowed) {
        return withRequestIdHeader(
          withSecurityHeaders(NextResponse.json({ error: decision.reason }, { status: 403 })),
          requestId,
        );
      }
    }

    // 2. Persistently guard the two large AI handlers without duplicating their
    // generation logic. The internal proxy signs its forwarded request with a
    // token derived from SESSION_SECRET; user-supplied bypass headers are removed.
    if (req.method === "POST" && GUARDED_AI_ROUTE.test(req.nextUrl.pathname)) {
      const token = await deriveInternalGuardToken();
      if (!token) {
        return withRequestIdHeader(
          withSecurityHeaders(NextResponse.json({ error: "AI request guard is unavailable" }, { status: 503 })),
          requestId,
        );
      }

      const requestHeaders = withRequestIdDownstream(new Headers(req.headers), requestId);
      const suppliedToken = requestHeaders.get(INTERNAL_GUARD_HEADER);
      requestHeaders.delete(INTERNAL_GUARD_HEADER);

      if (suppliedToken === token) {
        return withRequestIdHeader(
          withSecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } })),
          requestId,
        );
      }

      const originalTarget = `${req.nextUrl.pathname}${req.nextUrl.search}`;
      const guardUrl = req.nextUrl.clone();
      guardUrl.pathname = "/api/internal/rate-guard";
      guardUrl.search = "";
      guardUrl.searchParams.set("target", originalTarget);

      // Also pass the target as a request header. After a middleware rewrite to
      // an API route, the destination handler's `req.url` reflects the ORIGINAL
      // request URL (without our `?target=` query) in the Node runtime — so the
      // query param alone is not reliably readable downstream. Request headers,
      // by contrast, always propagate via `request: { headers }`. The rate-guard
      // reads the header first and falls back to the query param.
      requestHeaders.set("x-hope-guard-target", originalTarget);

      return withRequestIdHeader(
        withSecurityHeaders(NextResponse.rewrite(guardUrl, { request: { headers: requestHeaders } })),
        requestId,
      );
    }

    // 3. Standard response with security headers. Propagate the request ID
    // downstream so route handlers see the same correlation ID without
    // having to generate their own.
    const downstreamHeaders = withRequestIdDownstream(new Headers(req.headers), requestId);
    return withRequestIdHeader(
      withSecurityHeaders(NextResponse.next({ request: { headers: downstreamHeaders } })),
      requestId,
    );
  });
}

export const config = {
  // Single matcher covers all routes except Next.js static assets.
  // (Previously had a redundant "/api/:path*" entry that was fully covered
  // by the negative-lookahead pattern below.)
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
