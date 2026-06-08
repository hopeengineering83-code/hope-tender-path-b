import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateCsrf, shouldEnforceCsrf } from "../lib/security/csrf";

describe("CSRF policy", () => {
  it("does not enforce for safe methods", () => {
    assert.equal(shouldEnforceCsrf({ method: "GET", pathname: "/api/tenders", nodeEnv: "production" }), false);
  });

  it("enforces same-origin checks in production for unsafe API requests", () => {
    assert.equal(shouldEnforceCsrf({ method: "POST", pathname: "/api/tenders", nodeEnv: "production" }), true);
  });

  it("rejects missing origin or referer when enforcement is active", () => {
    const result = evaluateCsrf({ method: "POST", pathname: "/api/tenders", expectedOrigin: "https://app.example.com", nodeEnv: "production" });
    assert.equal(result.enforce, true);
    assert.equal(result.allowed, false);
  });

  it("accepts same-origin origin header", () => {
    const result = evaluateCsrf({ method: "POST", pathname: "/api/tenders", expectedOrigin: "https://app.example.com", origin: "https://app.example.com", nodeEnv: "production" });
    assert.equal(result.allowed, true);
  });

  it("can be enforced in development for tests", () => {
    const result = evaluateCsrf({ method: "POST", pathname: "/api/tenders", expectedOrigin: "http://localhost:3000", nodeEnv: "development", csrfStrictDev: "true" });
    assert.equal(result.enforce, true);
    assert.equal(result.allowed, false);
  });

  it("can be disabled explicitly for local-only tooling", () => {
    const result = evaluateCsrf({ method: "POST", pathname: "/api/tenders", expectedOrigin: "http://localhost:3000", nodeEnv: "production", csrfMode: "off" });
    assert.equal(result.enforce, false);
    assert.equal(result.allowed, true);
  });
});
