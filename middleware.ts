import { NextResponse, type NextRequest } from "next/server";
import { deriveRoutedRequestOrigin, evaluateCsrf } from "./lib/security/csrf";
import { getProductionCSP, generateCspNonce } from "./lib/security/csp";
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
  const workerSecret = process.env.AI_JOBS_WORKER_SECRET;
  const workerHeader = req.headers.get(WORKER_SECRET_HEADER);
  if (workerSecret && workerSecret.length >= 16 && workerHeader && workerHeader === workerSecret) {
    return true;
  }

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

function withSecurityHeaders(response: NextResponse, nonce?: string): NextResponse {
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Content-Security-Policy", getProductionCSP(nonce));
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
  }
  return response;
}

function withRequestIdHeader(response: NextResponse, requestId: string): NextResponse {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

function withRequestIdDownstream(requestHeaders: Headers, requestId: string): Headers {
  if (!requestHeaders.has(REQUEST_ID_HEADER)) {
    requestHeaders.set(REQUEST_ID_HEADER, requestId);
  }
  return requestHeaders;
}

export async function middleware(req: NextRequest) {
  const requestId = extractRequestId(req as unknown as Request);
  const cspNonce = generateCspNonce();

  return withRequestId(requestId, async () => {
    const guardedAiRoute = req.method === "POST" && GUARDED_AI_ROUTE.test(req.nextUrl.pathname);
    const guardToken = guardedAiRoute ? await deriveInternalGuardToken() : null;

    /**
     * /api/internal/rate-guard re-issues the guarded request server-side with
     * this SESSION_SECRET-derived token. That internal hop resolves its target
     * from `req.url`, which Next normalizes (127.0.0.1 becomes localhost) and
     * which a reverse proxy or custom domain rewrites outright, so its Host
     * routinely disagrees with the browser Origin it forwards. Re-running the
     * browser CSRF check against it therefore rejected every AI Analyze and
     * Generate Docs request whenever the two hostnames differed.
     *
     * Skipping the origin check here does not weaken the gate: the token is a
     * SHA-256 of a server-only secret and cannot be produced by a cross-site
     * caller, and the browser-facing request that triggered the rewrite was
     * already fully CSRF-checked below before the guard ever saw it.
     */
    const trustedInternalGuardHop =
      guardToken !== null && req.headers.get(INTERNAL_GUARD_HEADER) === guardToken;

    if (!isAutomatedCaller(req) && !trustedInternalGuardHop) {
      const expectedOrigin = deriveRoutedRequestOrigin({
        requestUrlOrigin: req.nextUrl.origin,
        host: req.headers.get("host"),
        forwardedHost: req.headers.get("x-forwarded-host"),
        forwardedProto: req.headers.get("x-forwarded-proto"),
      });
      const decision = evaluateCsrf({
        method: req.method,
        pathname: req.nextUrl.pathname,
        expectedOrigin,
        origin: req.headers.get("origin"),
        referer: req.headers.get("referer"),
        nodeEnv: process.env.NODE_ENV,
        csrfMode: process.env.CSRF_MODE,
        csrfStrictDev: process.env.CSRF_STRICT_DEV,
      });

      if (!decision.allowed) {
        return withRequestIdHeader(
          withSecurityHeaders(NextResponse.json({ error: decision.reason }, { status: 403 }), cspNonce),
          requestId,
        );
      }
    }

    if (guardedAiRoute) {
      if (!guardToken) {
        return withRequestIdHeader(
          withSecurityHeaders(NextResponse.json({ error: "AI request guard is unavailable" }, { status: 503 }), cspNonce),
          requestId,
        );
      }

      const requestHeaders = withRequestIdDownstream(new Headers(req.headers), requestId);
      requestHeaders.set("x-nonce", cspNonce);
      requestHeaders.delete(INTERNAL_GUARD_HEADER);

      if (trustedInternalGuardHop) {
        return withRequestIdHeader(
          withSecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }), cspNonce),
          requestId,
        );
      }

      const originalTarget = `${req.nextUrl.pathname}${req.nextUrl.search}`;
      const guardUrl = req.nextUrl.clone();
      guardUrl.pathname = "/api/internal/rate-guard";
      guardUrl.search = "";
      guardUrl.searchParams.set("target", originalTarget);
      requestHeaders.set("x-hope-guard-target", originalTarget);

      return withRequestIdHeader(
        withSecurityHeaders(NextResponse.rewrite(guardUrl, { request: { headers: requestHeaders } }), cspNonce),
        requestId,
      );
    }

    const downstreamHeaders = withRequestIdDownstream(new Headers(req.headers), requestId);
    downstreamHeaders.set("x-nonce", cspNonce);
    return withRequestIdHeader(
      withSecurityHeaders(NextResponse.next({ request: { headers: downstreamHeaders } }), cspNonce),
      requestId,
    );
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
