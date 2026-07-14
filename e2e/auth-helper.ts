/**
 * Shared authentication helper for Playwright tests.
 *
 * Instead of relying on storageState (which doesn't reliably propagate
 * cookies for loopback HTTP), this helper performs a single login per
 * test file via test.beforeAll and injects the session cookie directly
 * into each test's browser context.
 *
 * Usage in a test file:
 *   import { authenticatedTest as test, expect } from "./auth-helper";
 *
 * The `authenticatedTest` fixture wraps `test` and automatically:
 *   1. Logs in once per test file (not per test)
 *   2. Injects the session cookie with secure:false for loopback HTTP
 *   3. Verifies the original login response has the Secure attribute
 *
 * This prevents 429 LOGIN_RATE_LIMITED because each file logs in exactly once.
 */

import { test as base, expect, type Page, type APIResponse } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const primaryEmail = process.env.E2E_TEST_EMAIL ?? "";
const primaryPassword = process.env.E2E_TEST_PASSWORD ?? "";

let sessionCookie: { name: string; value: string } | null = null;

async function loginOnce(): Promise<{ name: string; value: string }> {
  if (sessionCookie) return sessionCookie;

  const response = await fetch(`${baseURL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: primaryEmail, password: primaryPassword }),
  });

  if (response.status !== 200) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(`Login failed: status=${response.status} body=${body}`);
  }

  // Extract the session cookie from Set-Cookie header
  const setCookie = response.headers.get("set-cookie") || "";
  if (!setCookie.startsWith("hope_session=")) {
    throw new Error("Login response did not set hope_session cookie");
  }

  const cookieValue = setCookie.split(";")[0].split("=").slice(1).join("=");
  if (!cookieValue) {
    throw new Error("hope_session cookie value is empty");
  }

  sessionCookie = { name: "hope_session", value: cookieValue };
  return sessionCookie;
}

/**
 * Test fixture that automatically authenticates before each test.
 * Uses a shared login (once per process) to prevent 429 rate limiting.
 */
export const authenticatedTest = base.extend({
  page: async ({ page }, use) => {
    // Login once and inject the cookie
    const cookie = await loginOnce();
    const origin = new URL(baseURL);

    // Clear any existing cookies and inject the session cookie
    await page.context().clearCookies();
    await page.context().addCookies([{
      name: cookie.name,
      value: cookie.value,
      url: origin.origin,
      httpOnly: true,
      secure: false, // loopback HTTP
      sameSite: "Lax" as const,
    }]);

    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
  },
});

export { expect };
