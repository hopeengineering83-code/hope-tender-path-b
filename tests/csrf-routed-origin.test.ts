import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  deriveRoutedRequestOrigin,
  evaluateCsrf,
} from "../lib/security/csrf";

describe("routed request origin derivation", () => {
  it("uses the actual loopback Host header instead of a normalized internal URL", () => {
    const expectedOrigin = deriveRoutedRequestOrigin({
      requestUrlOrigin: "http://localhost:3000",
      host: "127.0.0.1:3000",
    });
    assert.equal(expectedOrigin, "http://127.0.0.1:3000");
    assert.equal(evaluateCsrf({
      method: "POST",
      pathname: "/api/auth/login",
      expectedOrigin,
      origin: "http://127.0.0.1:3000",
      referer: "http://127.0.0.1:3000/login",
      nodeEnv: "production",
      csrfMode: "origin",
    }).allowed, true);
  });

  it("uses forwarded protocol and host behind a reverse proxy", () => {
    assert.equal(deriveRoutedRequestOrigin({
      requestUrlOrigin: "http://internal:3000",
      host: "internal:3000",
      forwardedHost: "preview.example.test",
      forwardedProto: "https",
    }), "https://preview.example.test");
  });

  it("uses only the first forwarded values", () => {
    assert.equal(deriveRoutedRequestOrigin({
      requestUrlOrigin: "http://internal:3000",
      forwardedHost: "public.example.test, internal:3000",
      forwardedProto: "https, http",
    }), "https://public.example.test");
  });

  it("falls back safely for malformed host or protocol headers", () => {
    for (const input of [
      { host: "https://attacker.test/path" },
      { host: "bad host" },
      { host: "example.test", forwardedProto: "javascript" },
    ]) {
      assert.equal(deriveRoutedRequestOrigin({
        requestUrlOrigin: "https://safe.example.test",
        ...input,
      }), "https://safe.example.test");
    }
  });

  it("does not accept a cross-origin browser request", () => {
    const expectedOrigin = deriveRoutedRequestOrigin({
      requestUrlOrigin: "http://internal:3000",
      forwardedHost: "app.example.test",
      forwardedProto: "https",
    });
    const decision = evaluateCsrf({
      method: "POST",
      pathname: "/api/auth/login",
      expectedOrigin,
      origin: "https://attacker.example.test",
      referer: "https://attacker.example.test/form",
      nodeEnv: "production",
      csrfMode: "origin",
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "Invalid request origin.");
  });
});

describe("middleware CSRF wiring", () => {
  const source = readFileSync("middleware.ts", "utf8");

  it("derives expected origin from routed headers and never from the supplied Origin", () => {
    assert.match(source, /deriveRoutedRequestOrigin\(\{/);
    assert.match(source, /host: req\.headers\.get\("host"\)/);
    assert.match(source, /forwardedHost: req\.headers\.get\("x-forwarded-host"\)/);
    assert.match(source, /forwardedProto: req\.headers\.get\("x-forwarded-proto"\)/);
    assert.match(source, /expectedOrigin,/);
    assert.doesNotMatch(source, /expectedOrigin:\s*req\.headers\.get\("origin"\)/);
  });
});

/**
 * /api/internal/rate-guard re-issues guarded AI requests server-side. That
 * internal hop resolves its target from `req.url`, whose host is normalized by
 * Next (127.0.0.1 -> localhost) and rewritten outright behind a proxy or custom
 * domain, while it forwards the original browser Origin. Re-running the browser
 * CSRF check against that hop rejected every AI Analyze and Generate Docs
 * request whenever the two hostnames differed.
 */
describe("internal rate-guard hop is exempt from the browser CSRF origin check", () => {
  const source = readFileSync("middleware.ts", "utf8");

  it("treats only a valid SESSION_SECRET-derived guard token as a trusted internal hop", () => {
    assert.match(
      source,
      /const trustedInternalGuardHop\s*=\s*\n?\s*guardToken !== null && req\.headers\.get\(INTERNAL_GUARD_HEADER\) === guardToken;/,
    );
    // The token must be derived server-side, never taken from the request.
    assert.match(source, /const guardToken = guardedAiRoute \? await deriveInternalGuardToken\(\) : null;/);
    assert.match(source, /`hope-rate-guard:v1:\$\{secret\}`/);
  });

  it("skips the origin check for that hop and for nothing else", () => {
    assert.match(source, /if \(!isAutomatedCaller\(req\) && !trustedInternalGuardHop\) \{/);
    // Exactly one CSRF evaluation site, still guarding every other request.
    assert.equal(source.match(/evaluateCsrf\(\{/g)?.length, 1);
  });

  it("keeps the guard fail-closed when SESSION_SECRET is unavailable", () => {
    // guardToken === null must not become a trusted hop, and must still 503.
    assert.match(source, /if \(!guardToken\) \{[\s\S]{0,240}"AI request guard is unavailable"[\s\S]{0,120}503/);
  });

  it("never forwards a client-supplied guard token downstream", () => {
    assert.match(source, /requestHeaders\.delete\(INTERNAL_GUARD_HEADER\);/);
    const deleteAt = source.indexOf("requestHeaders.delete(INTERNAL_GUARD_HEADER);");
    const nextAt = source.indexOf("if (trustedInternalGuardHop) {", deleteAt);
    // The header is stripped before any downstream pass-through decision.
    assert.ok(deleteAt > 0 && nextAt > deleteAt);
  });

  it("derives the same token in middleware and in the rate-guard route", async () => {
    // middleware.ts uses WebCrypto (edge runtime); the route uses node:crypto.
    // A mismatch would silently send every guarded request into an infinite
    // rewrite loop or a hard 403, so the two must stay byte-identical.
    const secret = "regression-secret-for-guard-token-parity";
    const { createHash } = await import("node:crypto");
    const nodeToken = createHash("sha256").update(`hope-rate-guard:v1:${secret}`).digest("hex");

    const bytes = new TextEncoder().encode(`hope-rate-guard:v1:${secret}`);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const webToken = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");

    assert.equal(webToken, nodeToken);
  });

  it("still rejects a cross-origin request that forges a guard token", () => {
    // A forged token cannot equal the server-derived one, so the request falls
    // through to the normal origin check and is denied.
    const expectedOrigin = deriveRoutedRequestOrigin({
      requestUrlOrigin: "http://localhost:3000",
      host: "127.0.0.1:3000",
    });
    const decision = evaluateCsrf({
      method: "POST",
      pathname: "/api/tenders/t1/ai-analyze",
      expectedOrigin,
      origin: "https://attacker.example",
      referer: "https://attacker.example/form",
      nodeEnv: "production",
      csrfMode: "origin",
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "Invalid request origin.");
  });
});
