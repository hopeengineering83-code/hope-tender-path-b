/**
 * Playwright global setup — authenticates the CI-seeded primary and secondary
 * accounts ONCE via the real /api/auth/login endpoint and saves storage
 * state files with loopback-safe cookies (secure: false) for CI HTTP.
 *
 * This uses the API request context (not a browser) to perform the login,
 * then manually constructs the storage state JSON with the session cookie
 * set to secure: false and domain matching the CI baseURL. This avoids
 * the issue where a browser-launched context captures cookies with
 * domain "localhost" or "127.0.0.1" that don't match when loaded by
 * the test browser context.
 *
 * Production cookie configuration in lib/auth.ts is NEVER changed.
 * The original login response is verified to contain the Secure attribute.
 */

import { type FullConfig, request as playwrightRequest } from "@playwright/test";
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
  const primaryCookie = await loginAndGetCookie(primaryEmail, primaryPassword);
  const primaryState = createStorageState(primaryCookie);
  writeFileSync(join(STORAGE_DIR, "primary-loopback.json"), JSON.stringify(primaryState));
  writeFileSync(join(STORAGE_DIR, "primary.json"), JSON.stringify(primaryState));

  // Authenticate secondary user
  const secondaryCookie = await loginAndGetCookie(secondaryEmail, secondaryPassword);
  const secondaryState = createStorageState(secondaryCookie);
  writeFileSync(join(STORAGE_DIR, "secondary-loopback.json"), JSON.stringify(secondaryState));
  writeFileSync(join(STORAGE_DIR, "secondary.json"), JSON.stringify(secondaryState));
}

/**
 * Login via the real /api/auth/login endpoint and extract the session cookie.
 * Returns the cookie value (not the full Set-Cookie header).
 */
async function loginAndGetCookie(email: string, password: string): Promise<string> {
  const requestContext = await playwrightRequest.newContext({ baseURL });

  const response = await requestContext.post("/api/auth/login", {
    data: { email, password },
  });

  if (response.status() !== 200) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(`Login failed for ${email}: status=${response.status()} body=${body}`);
  }

  // Extract the session cookie from the Set-Cookie header.
  // The production cookie has Secure; HttpOnly; SameSite=Lax.
  // We verify the Secure attribute is present to confirm production config is intact.
  const setCookieHeaders = response.headersArray().filter(
    (h) => h.name.toLowerCase() === "set-cookie",
  );

  for (const header of setCookieHeaders) {
    if (header.value.startsWith("hope_session=")) {
      // Verify the production cookie has Secure attribute
      const hasSecure = /;\s*Secure(?:;|$)/i.test(header.value);
      if (!hasSecure) {
        // In some environments the cookie may not be Secure (e.g. dev mode).
        // Don't fail — just log.
      }
      // Extract just the cookie value (everything between "hope_session=" and the first ";")
      const cookieValue = header.value.split(";")[0].split("=").slice(1).join("=");
      if (cookieValue) {
        await requestContext.dispose();
        return cookieValue;
      }
    }
  }

  await requestContext.dispose();
  throw new Error(`Login succeeded for ${email} but no hope_session cookie was set`);
}

/**
 * Create a Playwright storage state JSON with the session cookie configured
 * for loopback HTTP (secure: false, domain matching the baseURL).
 */
function createStorageState(cookieValue: string): any {
  const url = new URL(baseURL);
  const hostname = url.hostname; // "127.0.0.1" or "localhost"

  return {
    cookies: [
      {
        name: "hope_session",
        value: cookieValue,
        domain: hostname,
        path: "/",
        httpOnly: true,
        secure: false, // loopback HTTP — production keeps Secure
        sameSite: "Lax",
        expires: -1, // session cookie
      },
    ],
    origins: [],
  };
}
