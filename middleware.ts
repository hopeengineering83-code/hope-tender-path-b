import { NextResponse, type NextRequest } from "next/server";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isSameOriginRequest(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const expectedOrigin = req.nextUrl.origin;

  if (origin) {
    return origin === expectedOrigin;
  }

  if (referer) {
    try {
      return new URL(referer).origin === expectedOrigin;
    } catch {
      return false;
    }
  }

  // Browser state-changing requests should carry Origin or Referer. Rejecting
  // missing provenance prevents silent CSRF bypasses from non-same-origin pages.
  return false;
}

export function middleware(req: NextRequest) {
  // Codespaces and local development proxy requests through preview domains,
  // so strict Origin checks produce false positives. Keep this guard for
  // production deployments only.
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }

  if (!req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    return NextResponse.next();
  }

  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
