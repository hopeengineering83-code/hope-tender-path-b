import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { getProductionCSP } from "../lib/security/csp";

describe("Security Hardening", () => {
  it("CSP should not contain unsafe-eval", () => {
    const csp = getProductionCSP();
    assert.ok(!csp.includes("'unsafe-eval'"), "Production CSP must not allow unsafe-eval");
  });

  it("CSP should contain frame-ancestors none", () => {
    const csp = getProductionCSP();
    assert.ok(csp.includes("frame-ancestors 'none'"), "Production CSP must restrict framing");
  });
});
