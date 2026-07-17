import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("post-audit authentication and landing truth", () => {
  it("forgot-password sends instructions without exposing a reset link", () => {
    const source = read("app/forgot-password/page.tsx");

    assert.match(source, /Send Reset Instructions/);
    assert.match(source, /send reset instructions/i);
    assert.doesNotMatch(source, /data\.resetLink/);
    assert.doesNotMatch(source, /navigator\.clipboard/);
  });

  it("login fields have explicit labels and browser form contracts", () => {
    const source = read("components/login-form.tsx");

    assert.match(source, /htmlFor="login-email"/);
    assert.match(source, /id="login-email"/);
    assert.match(source, /name="email"/);
    assert.match(source, /htmlFor="login-password"/);
    assert.match(source, /id="login-password"/);
    assert.match(source, /name="password"/);
    assert.ok((source.match(/\brequired\b/g) ?? []).length >= 2);
  });

  it("public landing page exposes one sign-in action instead of authenticated actions", () => {
    const source = read("app/page.tsx");

    assert.match(source, /href="\/login"/);
    assert.match(source, />\s*Sign in\s*</);
    assert.doesNotMatch(source, />\s*Open Dashboard\s*</);
    assert.doesNotMatch(source, />\s*Create Tender\s*</);
  });
});
