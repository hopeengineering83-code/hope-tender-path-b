/**
 * Shared authentication fixtures for Playwright tests.
 *
 * This file performs NO live login. All authentication happens exactly
 * once per account, in e2e/global-setup.ts, via the real /api/auth/login
 * endpoint. global-setup.ts writes the resulting session cookie to
 * .auth/primary-loopback.json and .auth/secondary-loopback.json.
 *
 * Fixtures here only READ those files and inject the saved cookie into a
 * fresh browser context. This is what keeps total login calls per CI run
 * at exactly two (one primary, one secondary), regardless of how many
 * spec files or projects consume these fixtures, and regardless of
 * Playwright retries (retries reuse the same on-disk saved state; they
 * never trigger a new login).
 *
 * Exported fixtures:
 *   - anonymousTest      no session cookie at all
 *   - primaryTest        primary account, desktop viewport (via project config)
 *   - secondaryTest      secondary account, desktop viewport (via project config)
 *   - tabletPrimaryTest  primary account, tablet viewport (via project config)
 *   - tabletAnonymousTest no session cookie, tablet viewport (via project config)
 *
 * The tablet variants are the same cookie-loading logic as their desktop
 * counterparts — viewport comes entirely from the Playwright project
 * (samsung-tablet-primary / samsung-tablet-anonymous), not from this file.
 * They're kept as distinct exports so spec files can declare intent
 * explicitly and so misrouted specs (wrong project) are easy to spot.
 */

import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const STORAGE_DIR = join(process.cwd(), ".auth");
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

interface SavedCookie {
  name: string;
  value: string;
  httpOnly: boolean;
  sameSite: "Lax" | "Strict" | "None";
}

interface SavedStorageState {
  cookies: SavedCookie[];
}

export function loadSavedSessionCookie(filename: string): SavedCookie {
  const filePath = join(STORAGE_DIR, filename);
  if (!existsSync(filePath)) {
    throw new Error(
      `${filePath} was not found. Playwright global setup (e2e/global-setup.ts) must run ` +
        `and log in exactly once before authenticated tests execute. Confirm globalSetup is wired ` +
        `into playwright.config.ts and that the relevant E2E_TEST_EMAIL/E2E_TEST_PASSWORD or ` +
        `E2E_SECOND_EMAIL/E2E_SECOND_PASSWORD env vars are set for this CI run.`,
    );
  }
  const state = JSON.parse(readFileSync(filePath, "utf-8")) as SavedStorageState;
  const cookie = state.cookies.find((c) => c.name === "hope_session");
  if (!cookie) {
    throw new Error(`${filePath} does not contain a hope_session cookie.`);
  }
  return cookie;
}

/**
 * Injects a saved session cookie into an arbitrary browser context. Exported
 * so specs that need two genuinely isolated, simultaneous identities (e.g.
 * cross-user-isolation.spec.ts) can load the primary session into one
 * context and the secondary session into a second, independent context —
 * never mutating one context's identity into the other's.
 */
export async function injectSavedSessionIntoContext(context: BrowserContext, filename: string) {
  const saved = loadSavedSessionCookie(filename);
  const origin = new URL(baseURL);
  await context.addCookies([
    {
      name: saved.name,
      value: saved.value,
      url: origin.origin,
      httpOnly: saved.httpOnly,
      // Loopback HTTP CI serves the app over http://127.0.0.1 — only this
      // saved test copy of the cookie is downgraded to secure:false so the
      // browser will actually send it. The production cookie written by
      // lib/auth.ts always keeps Secure; global setup verifies this at
      // login time and fails hard if it's ever missing.
      secure: false,
      sameSite: saved.sameSite,
    },
  ]);
}

async function injectSavedSession(page: Page, filename: string) {
  await page.context().clearCookies();
  await injectSavedSessionIntoContext(page.context(), filename);
}

async function clearSession(page: Page) {
  await page.context().clearCookies();
}

export const primaryTest = base.extend({
  page: async ({ page }, use) => {
    await injectSavedSession(page, "primary-loopback.json");
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
  },
});

export const secondaryTest = base.extend({
  page: async ({ page }, use) => {
    await injectSavedSession(page, "secondary-loopback.json");
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
  },
});

export const anonymousTest = base.extend({
  page: async ({ page }, use) => {
    await clearSession(page);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
  },
});

export const tabletPrimaryTest = primaryTest;
export const tabletAnonymousTest = anonymousTest;

export { expect };
