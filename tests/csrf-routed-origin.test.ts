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
