import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { getProductionCSP } from "../lib/security/csp";

describe("Security Hardening", () => {
  it("CSP should not contain unsafe-eval", () => {
    const csp = getProductionCSP();
    assert.ok(!csp.includes("'unsafe-eval'"), "Production CSP must not allow unsafe-eval");
  });

  it("CSP should contain the complete runtime directives", () => {
    const csp = getProductionCSP();
    assert.ok(csp.includes("frame-ancestors 'none'"), "Production CSP must restrict framing");
    assert.ok(csp.includes("worker-src 'self' blob:"), "Production CSP must authorize same-origin/blob workers");
    assert.ok(csp.includes("media-src 'self' blob:"), "Production CSP must authorize same-origin/blob media");
    assert.ok(csp.includes("upgrade-insecure-requests"), "Production CSP must upgrade insecure subresource requests");
  });

  it("middleware should emit two-year HSTS and omit obsolete X-XSS-Protection", () => {
    const source = readFileSync("middleware.ts", "utf8");
    assert.match(source, /Strict-Transport-Security[\s\S]*max-age=63072000; includeSubDomains; preload/);
    assert.doesNotMatch(source, /X-XSS-Protection/);
  });

  it("next.config should not duplicate runtime CSP or HSTS headers", () => {
    const source = readFileSync("next.config.js", "utf8");
    assert.doesNotMatch(source, /Content-Security-Policy/);
    assert.doesNotMatch(source, /Strict-Transport-Security/);
    assert.doesNotMatch(source, /async\s+headers\s*\(/);
    assert.match(source, /withNextIntl\(nextConfig\)/, "Active localization integration must remain configured");
  });
});
