import { NextResponse, type NextRequest } from "next/server";
import { evaluateCsrf } from "./lib/security/csrf";
import { getProductionCSP } from "./lib/security/csp";

const INTERNAL_GUARD_HEADER = "x-hope-internal-rate-guard";
const GUARDED_AI_ROUTE = /^\/api\/tenders\/[^/?]+\/(ai-analyze|generate)$/;

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

export async function middleware(req: NextRequest) {
  // 1. CSRF Protection
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
    return withSecurityHeaders(NextResponse.json({ error: decision.reason }, { status: 403 }));
  }

  // 2. Persistently guard the two large AI handlers without duplicating their
  // generation logic. The internal proxy signs its forwarded request with a
  // token derived from SESSION_SECRET; user-supplied bypass headers are removed.
  if (req.method === "POST" && GUARDED_AI_ROUTE.test(req.nextUrl.pathname)) {
    const token = await deriveInternalGuardToken();
    if (!token) {
      return withSecurityHeaders(NextResponse.json({ error: "AI request guard is unavailable" }, { status: 503 }));
    }

    const requestHeaders = new Headers(req.headers);
    const suppliedToken = requestHeaders.get(INTERNAL_GUARD_HEADER);
    requestHeaders.delete(INTERNAL_GUARD_HEADER);

    if (suppliedToken === token) {
      return withSecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
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

    return withSecurityHeaders(NextResponse.rewrite(guardUrl, { request: { headers: requestHeaders } }));
  }

  // 3. Standard response with security headers.
  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/api/:path*", "/((?!_next/static|_next/image|favicon.ico).*)"],
};
