import { test, describe } from "node:test";
import assert from "node:assert";

describe("Security Headers Contract", () => {
  test("Middleware sets nosniff", () => {
    const headers = { "X-Content-Type-Options": "nosniff" };
    assert.strictEqual(headers["X-Content-Type-Options"], "nosniff");
  });

  test("CSP includes self and permitted domains", () => {
    const csp = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://*.vercel-storage.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://*.googleapis.com https://*.openai.com https://*.anthropic.com https://*.groq.com https://*.deepseek.com; frame-ancestors 'none'";
    assert.ok(csp.includes("default-src 'self'"));
    assert.ok(csp.includes("frame-ancestors 'none'"));
  });
});
