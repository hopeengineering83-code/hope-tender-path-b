// Post-audit gap closure tests
// Tests for F-03, F-05, F-08, F-12, P1 (forgot-password), P2 (login a11y, landing)

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("F-03 — Matching page bounded take", () => {
  it("matching page has take:20 on match includes", () => {
    const src = readFileSync("app/dashboard/matching/page.tsx", "utf8");
    assert.match(src, /take:\s*20/, "Matching page must have take:20 on match includes");
  });
});

describe("F-05 — AI readiness mobile overflow", () => {
  it("no overflow-hidden in className", () => {
    const src = readFileSync("app/dashboard/admin/ai-readiness/page.tsx", "utf8");
    assert.ok(!/className="[^"]*overflow-hidden/.test(src), "Must not use overflow-hidden");
  });
  it("has overflow-x-auto", () => {
    const src = readFileSync("app/dashboard/admin/ai-readiness/page.tsx", "utf8");
    assert.match(src, /overflow-x-auto/);
  });
  it("has mobile cards (sm:hidden)", () => {
    const src = readFileSync("app/dashboard/admin/ai-readiness/page.tsx", "utf8");
    assert.match(src, /sm:hidden/);
  });
});

describe("F-08 — Documents heading", () => {
  it("says Document Workspace not Generated Documents", () => {
    const src = readFileSync("app/dashboard/documents/page.tsx", "utf8");
    assert.match(src, /Document Workspace/);
    assert.ok(!src.includes("Generated Documents"));
  });
});

describe("F-12 — 404 label", () => {
  it("says Return home not Return to dashboard", () => {
    const src = readFileSync("app/not-found.tsx", "utf8");
    assert.match(src, /Return home/);
    assert.ok(!src.includes("Return to dashboard"));
  });
});

describe("P1 — Forgot-password screen contradiction", () => {
  it("says 'Send Reset Instructions' not 'Generate Reset Link'", () => {
    const src = readFileSync("app/forgot-password/page.tsx", "utf8");
    assert.match(src, /Send Reset Instructions/);
    assert.ok(!src.includes("Generate Reset Link"));
  });
  it("does not display or copy resetLink", () => {
    const src = readFileSync("app/forgot-password/page.tsx", "utf8");
    assert.ok(!src.includes("result.resetLink"), "Must not reference result.resetLink");
    assert.ok(!src.includes("Copy to clipboard"), "Must not have copy-to-clipboard for reset link");
  });
  it("does not say 'generate a reset link'", () => {
    const src = readFileSync("app/forgot-password/page.tsx", "utf8");
    const fpLines = src.split("\n").filter(l => !l.trim().startsWith("//")); const fpCode = fpLines.join("\n"); assert.ok(!/generate a reset link/i.test(fpCode), "Must not say 'generate a reset link'");
  });
});

describe("P2 — Login accessibility", () => {
  it("email label has htmlFor", () => {
    const src = readFileSync("components/login-form.tsx", "utf8");
    assert.match(src, /htmlFor="login-email"/);
  });
  it("email input has id and name", () => {
    const src = readFileSync("components/login-form.tsx", "utf8");
    assert.match(src, /id="login-email"/);
    assert.match(src, /name="email"/);
  });
  it("password label has htmlFor", () => {
    const src = readFileSync("components/login-form.tsx", "utf8");
    assert.match(src, /htmlFor="login-password"/);
  });
  it("password input has id and name", () => {
    const src = readFileSync("components/login-form.tsx", "utf8");
    assert.match(src, /id="login-password"/);
    assert.match(src, /name="password"/);
  });
  it("both inputs have required attribute", () => {
    const src = readFileSync("components/login-form.tsx", "utf8");
    const emailMatch = src.match(/type="email"[\s\S]*?required/);
    const passwordMatch = src.match(/type="password"[\s\S]*?required/);
    assert.ok(emailMatch, "Email input must have required");
    assert.ok(passwordMatch, "Password input must have required");
  });
});

describe("P2 — Landing page auth-aware actions", () => {
  it("has single 'Sign in' CTA", () => {
    const src = readFileSync("app/page.tsx", "utf8");
    assert.match(src, /Sign in/);
  });
  it("does not show 'Open Dashboard' to unauthenticated users", () => {
    const src = readFileSync("app/page.tsx", "utf8");
    const lpLines = src.split("\n").filter(l => !l.trim().startsWith("//")); const lpCode = lpLines.join("\n"); assert.ok(!lpCode.includes("Open Dashboard"), "Must not show 'Open Dashboard' on public landing");
  });
  it("does not show 'Create Tender' to unauthenticated users", () => {
    const src = readFileSync("app/page.tsx", "utf8");
    // Check only in actual JSX/HTML, not in comments
    const codeLines = src.split("\n").filter(l => !l.trim().startsWith("//"));
    const codeOnly = codeLines.join("\n");
    assert.ok(!codeOnly.includes("Create Tender"), "Must not show 'Create Tender' on public landing");
  });
});
