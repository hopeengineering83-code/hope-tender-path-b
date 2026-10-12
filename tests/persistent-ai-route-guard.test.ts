import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

const middleware = readFileSync("middleware.ts", "utf8");
const guard = readFileSync("app/api/internal/rate-guard/route.ts", "utf8");

function expectContains(source: string, pattern: RegExp, message: string) {
  assert.match(source, pattern, message);
}

describe("persistent AI route guard", () => {
  it("covers the large AI analysis and generation POST routes", () => {
    expectContains(middleware, /GUARDED_AI_ROUTE[\s\S]*ai-analyze\|generate/, "middleware must cover ai-analyze and generate");
    expectContains(middleware, /req\.method === "POST"/, "only mutation requests should be guarded");
    expectContains(middleware, /\/api\/internal\/rate-guard/, "guarded requests must be rewritten to the internal proxy");
  });

  it("does not trust a user-supplied bypass header", () => {
    // The bypass must compare against the server-derived token AND require it
    // to exist — a null token (no SESSION_SECRET) must never satisfy the check.
    expectContains(
      middleware,
      /guardToken !== null && req\.headers\.get\(INTERNAL_GUARD_HEADER\) === guardToken/,
      "bypass requires the derived internal token and a non-null secret",
    );
    expectContains(middleware, /requestHeaders\.delete\(INTERNAL_GUARD_HEADER\)/, "client bypass header must be removed before forwarding");
    expectContains(middleware, /crypto\.subtle\.digest\("SHA-256"/, "edge token must be derived from the server secret");
  });

  it("authenticates and applies the database-backed limiter before forwarding", () => {
    expectContains(guard, /const userId = await getSession\(\)/, "guard must authenticate the caller");
    expectContains(guard, /await rateLimitPersistent\(/, "guard must use the persistent limiter");
    expectContains(guard, /AI_RATE_LIMIT/, "guard must use the AI rate-limit preset");
    expectContains(guard, /status: 429/, "guard must reject excess requests with HTTP 429");
    expectContains(guard, /"Retry-After"/, "guard must return Retry-After");
  });

  it("cannot be used as an open proxy", () => {
    expectContains(guard, /targetUrl\.origin !== currentUrl\.origin/, "guard must enforce same-origin forwarding");
    expectContains(guard, /GUARDED_ROUTE\.test\(targetUrl\.pathname\)/, "guard must allow only explicit tender AI routes");
    expectContains(guard, /rawTarget\.length > 2_000/, "guard must bound the target input");
  });

  it("fails closed when the signing secret is unavailable", () => {
    expectContains(middleware, /AI request guard is unavailable[\s\S]*status: 503/, "middleware must fail closed without SESSION_SECRET");
    expectContains(guard, /AI request guard is unavailable[\s\S]*status: 503/, "proxy must fail closed without SESSION_SECRET");
  });

  it("propagates the rewrite target via a request header (not query-only)", () => {
    // Regression: after a middleware rewrite to an API route, the destination
    // handler's req.url reflects the ORIGINAL request URL (without our
    // ?target= query) in the Node runtime, so the guard read null and
    // returned "Invalid guarded route target". The target must travel as a
    // request header, which always propagates.
    expectContains(
      middleware,
      /requestHeaders\.set\("x-hope-guard-target", originalTarget\)/,
      "middleware must set the target as a request header before rewriting",
    );
    expectContains(
      guard,
      /req\.headers\.get\("x-hope-guard-target"\)\s*\?\?\s*currentUrl\.searchParams\.get\("target"\)/,
      "guard must read the target from the header first, falling back to the query param",
    );
  });
});
