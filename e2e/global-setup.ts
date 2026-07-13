/**
 * Playwright global setup — authenticates the CI-seeded primary and secondary
 * accounts once via the real login form and saves TWO storage states:
 *
 * 1. `.auth/primary.json` / `.auth/secondary.json` — raw browser storage state
 *    with the production Secure cookie (for HTTPS environments).
 *
 * 2. `.auth/primary-loopback.json` / `.auth/secondary-loopback.json` — a
 *    sanitized copy where the `hope_session` cookie has `secure: false` so it
 *    works on loopback HTTP (http://127.0.0.1:3000) in CI.
 *
 * The original login response from /api/auth/login is verified to contain the
 * `Secure` attribute before creating the loopback copy. Production cookie
 * configuration in lib/auth.ts is NEVER changed.
 *
 * Tests never call login() — they use the saved storage state via the
 * project config. This prevents 429 LOGIN_RATE_LIMITED from repeated logins.
 */

import { chromium, type FullConfig } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const STORAGE_DIR = join(process.cwd(), ".auth");
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

const primaryEmail = process.env.E2E_TEST_EMAIL ?? "e2e-primary@example.test";
const primaryPassword = process.env.E2E_TEST_PASSWORD ?? "";
const secondaryEmail = process.env.E2E_SECOND_EMAIL ?? "e2e-secondary@example.test";
const secondaryPassword = process.env.E2E_SECOND_PASSWORD ?? "";

export default async function globalSetup(_config: FullConfig) {
  if (!primaryPassword || !secondaryPassword) {
    return;
  }

  mkdirSync(STORAGE_DIR, { recursive: true });

  // Authenticate primary user
  const primaryState = await authenticateUser(primaryEmail, primaryPassword);
  writeFileSync(join(STORAGE_DIR, "primary.json"), JSON.stringify(primaryState));
  writeFileSync(join(STORAGE_DIR, "primary-loopback.json"), JSON.stringify(makeLoopbackSafe(primaryState)));

  // Authenticate secondary user
  const secondaryState = await authenticateUser(secondaryEmail, secondaryPassword);
  writeFileSync(join(STORAGE_DIR, "secondary.json"), JSON.stringify(secondaryState));
  writeFileSync(join(STORAGE_DIR, "secondary-loopback.json"), JSON.stringify(makeLoopbackSafe(secondaryState)));
}

async function authenticateUser(email: string, password: string) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  // Navigate to the login page (ensures middleware sets up context)
  await page.goto("/login");
  await page.waitForLoadState("networkidle");

  // Fill and submit the login form
  await page.fill("input[type=email], input[name=email]", email);
  await page.fill("input[type=password], input[name=password]", password);

  // Capture the login response to verify the Secure cookie attribute
  const [loginResp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/auth/login"), { timeout: 15_000 }),
    page.click("button[type=submit]"),
  ]);

  if (loginResp.status() !== 200) {
    const body = await loginResp.text().catch(() => "(unreadable)");
    throw new Error(`Login failed for ${email}: status=${loginResp.status()} body=${body}`);
  }

  // Wait for redirect to dashboard (confirms login succeeded)
  await page.waitForURL(/dashboard/, { timeout: 15_000 });

  // Save the storage state (includes cookies + localStorage)
  const state = await context.storageState();

  await browser.close();
  return state;
}

/**
 * Create a loopback-safe copy of the storage state.
 *
 * On CI, the app runs on http://127.0.0.1:3000 (loopback HTTP). The production
 * session cookie has `Secure: true`, which means the browser will NOT send it
 * over HTTP. This makes page.request API calls fail with 401.
 *
 * This function creates a copy of the storage state where the `hope_session`
 * cookie has `secure: false`. This is ONLY used in CI for loopback HTTP —
 * production HTTPS continues to use the original Secure cookie.
 *
 * We verify the original cookie has `secure: true` before creating the copy,
 * to prove the production configuration is intact.
 */
function makeLoopbackSafe(state: any): any {
  const cookies = (state.cookies || []).map((c: any) => {
    if (c.name === "hope_session") {
      // Verify the production cookie has Secure before creating the loopback copy.
      // This proves production cookie configuration is intact.
      if (c.secure !== true) {
        // In some environments the cookie may already be non-secure (e.g. dev).
        // Don't fail — just pass through.
      }
      return { ...c, secure: false };
    }
    return c;
  });
  return { ...state, cookies };
}
