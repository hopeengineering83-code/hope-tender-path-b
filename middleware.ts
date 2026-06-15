import { NextResponse, type NextRequest } from "next/server";
import { evaluateCsrf } from "./lib/security/csrf";
import { getProductionCSP } from "./lib/security/csp";

export function middleware(req: NextRequest) {
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
    return NextResponse.json({ error: decision.reason }, { status: 403 });
  }

  const response = NextResponse.next();

  // 2. Security Headers (Production only)
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

export const config = {
  matcher: ["/api/:path*", "/((?!_next/static|_next/image|favicon.ico).*)"],
};
