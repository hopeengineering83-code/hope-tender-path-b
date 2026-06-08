import { NextResponse, type NextRequest } from "next/server";
import { evaluateCsrf } from "./lib/security/csrf";

export function middleware(req: NextRequest) {
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

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
