/**
 * Playwright global setup — authenticates the CI-seeded primary and secondary
 * accounts once per browser project and saves the storage state to disk.
 * Tests then use the saved storage state instead of logging in repeatedly,
 * which prevents 429 LOGIN_RATE_LIMITED errors from the real production
 * rate limiter.
 *
 * The login is performed via the real /api/auth/login endpoint — no bypass.
 * The session cookie is captured from the Set-Cookie header and saved.
 * On loopback HTTP (CI), the Secure flag is stripped by the browser context
 * (Playwright handles this automatically when the context is created with
 * the saved storage state).
 */

import { chromium, type FullConfig } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const STORAGE_DIR = join(process.cwd(), ".auth");

const primaryEmail = process.env.E2E_TEST_EMAIL ?? "e2e-primary@example.test";
const primaryPassword = process.env.E2E_TEST_PASSWORD ?? "";
const secondaryEmail = process.env.E2E_SECOND_EMAIL ?? "e2e-secondary@example.test";
const secondaryPassword = process.env.E2E_SECOND_PASSWORD ?? "";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

export default async function globalSetup(config: FullConfig) {
  // Only authenticate if credentials are provided (CI mode)
  if (!primaryPassword || !secondaryPassword) {
    return;
  }

  mkdirSync(STORAGE_DIR, { recursive: true });

  // Authenticate primary user
  const primaryState = await authenticateUser(primaryEmail, primaryPassword);
  writeFileSync(join(STORAGE_DIR, "primary.json"), JSON.stringify(primaryState));

  // Authenticate secondary user
  const secondaryState = await authenticateUser(secondaryEmail, secondaryPassword);
  writeFileSync(join(STORAGE_DIR, "secondary.json"), JSON.stringify(secondaryState));
}

async function authenticateUser(email: string, password: string) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  // Navigate to the login page first (ensures middleware sets up CSRF context)
  await page.goto("/login");
  await page.waitForLoadState("networkidle");

  // Fill and submit the login form
  await page.fill("input[type=email], input[name=email]", email);
  await page.fill("input[type=password], input[name=password]", password);
  await page.click("button[type=submit]");

  // Wait for redirect to dashboard (confirms login succeeded)
  await page.waitForURL(/dashboard/, { timeout: 15_000 });

  // Save the storage state (includes cookies + localStorage)
  const state = await context.storageState();

  await browser.close();
  return state;
}
