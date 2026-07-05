import { logger } from "../../../../lib/observability";
import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { AI_RATE_LIMIT, rateLimitPersistent } from "../../../../lib/rate-limit";
import { sanitizeError } from "../../../../lib/sanitize-error";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const INTERNAL_GUARD_HEADER = "x-hope-internal-rate-guard";
const GUARDED_ROUTE = /^\/api\/tenders\/[^/?]+\/(ai-analyze|generate)$/;
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "cookie",
  "origin",
  "referer",
  "user-agent",
  "x-csrf-token",
  "x-request-id",
] as const;

function deriveInternalGuardToken(): string | null {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) return null;
  return createHash("sha256").update(`hope-rate-guard:v1:${secret}`).digest("hex");
}

function routePrefix(pathname: string): "analyze" | "generate" | null {
  if (pathname.endsWith("/ai-analyze")) return "analyze";
  if (pathname.endsWith("/generate")) return "generate";
  return null;
}

function forwardedHeaders(req: Request, token: string): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set(INTERNAL_GUARD_HEADER, token);
  return headers;
}

function responseHeaders(upstream: Response): Headers {
  const headers = new Headers(upstream.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("connection");
  headers.delete("keep-alive");
  headers.delete("transfer-encoding");
  if (!headers.has("cache-control")) headers.set("Cache-Control", "no-store");
  return headers;
}

export async function POST(req: Request) {
  const currentUrl = new URL(req.url);
  // Prefer the header set by middleware: after a rewrite to this API route,
  // `req.url` can reflect the original request URL (without our `?target=`
  // query) in the Node runtime, so the header is the reliable source. Fall
  // back to the query param for safety / older callers.
  const rawTarget = req.headers.get("x-hope-guard-target") ?? currentUrl.searchParams.get("target");
  if (!rawTarget || rawTarget.length > 2_000) {
    return NextResponse.json({ error: "Invalid guarded route target" }, { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(rawTarget, currentUrl.origin);
  } catch {
    return NextResponse.json({ error: "Invalid guarded route target" }, { status: 400 });
  }

  if (targetUrl.origin !== currentUrl.origin || !GUARDED_ROUTE.test(targetUrl.pathname)) {
    return NextResponse.json({ error: "Guarded route target is not allowed" }, { status: 400 });
  }

  const prefix = routePrefix(targetUrl.pathname);
  if (!prefix) return NextResponse.json({ error: "Guarded route target is not allowed" }, { status: 400 });

  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limiter = await rateLimitPersistent(`${prefix}:${userId}`, AI_RATE_LIMIT);
  if (!limiter.allowed) {
    const retryAfter = Math.max(1, Math.ceil((limiter.resetAt - Date.now()) / 1_000));
    return NextResponse.json(
      {
        error: prefix === "analyze"
          ? "Rate limit exceeded — too many analysis requests. Please wait and retry."
          : "Rate limit exceeded — too many generation requests. Please wait and retry.",
        code: "RATE_LIMITED",
        resetAt: limiter.resetAt,
        retryAfter,
      },
      { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } },
    );
  }

  const token = deriveInternalGuardToken();
  if (!token) {
    logger.error("[rate-guard] SESSION_SECRET is unavailable; guarded AI route denied");
    return NextResponse.json({ error: "AI request guard is unavailable" }, { status: 503 });
  }

  try {
    const body = await req.arrayBuffer();
    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers: forwardedHeaders(req, token),
      body: body.byteLength > 0 ? body : undefined,
      cache: "no-store",
      redirect: "manual",
    });

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders(upstream),
    });
  } catch (error) {
    logger.error(`[rate-guard] guarded upstream request failed: ${sanitizeError(error)}`);
    return NextResponse.json({ error: "Guarded AI request failed" }, { status: 502 });
  }
}
