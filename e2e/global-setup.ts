/**
 * Playwright global setup — authenticates the CI-seeded primary and secondary
 * accounts ONCE EACH (total: at most 2 logins per CI run, regardless of how
 * many spec files, projects, or retries follow) via the real
 * /api/auth/login endpoint, and saves the session cookie to a loopback-safe
 * JSON file for e2e/auth-helper.ts's fixtures to load.
 *
 * This uses the API request context (not a browser) to perform the login,
 * then writes only the cookie fields auth-helper.ts needs. CI serves the
 * app over loopback HTTP (127.0.0.1), so the saved test copy of the cookie
 * is downgraded to secure:false purely so the browser will send it back;
 * production cookie configuration in lib/auth.ts is never touched.
 *
 * The original login response's Set-Cookie header IS verified to contain
 * Secure; HttpOnly; SameSite=Lax. If Secure is missing, setup fails hard —
 * it does not silently continue, because that would mask a real regression
 * in production cookie policy.
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
  mkdirSync(STORAGE_DIR, { recursive: true });

  // Each account is independent: an environment that only configures the
  // primary account can still run primary-only suites. secondaryTest /
  // cross-user-isolation specs will fail loudly (via auth-helper.ts's
  // missing-file error) if the secondary account was never set up — that
  // is the correct behavior, not a silent skip.
  if (primaryPassword) {
    const cookie = await loginAndGetCookie(primaryEmail, primaryPassword);
    writeFileSync(join(STORAGE_DIR, "primary-loopback.json"), JSON.stringify(createStorageState(cookie)));
  }

  if (secondaryPassword) {
    const cookie = await loginAndGetCookie(secondaryEmail, secondaryPassword);
    writeFileSync(join(STORAGE_DIR, "secondary-loopback.json"), JSON.stringify(createStorageState(cookie)));
  }
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
    await requestContext.dispose();
    throw new Error(`Login failed for ${email}: status=${response.status()} body=${body}`);
  }

  const setCookieHeaders = response.headersArray().filter(
    (h) => h.name.toLowerCase() === "set-cookie",
  );

  for (const header of setCookieHeaders) {
    if (header.value.startsWith("hope_session=")) {
      const hasSecure = /;\s*Secure(?:;|$)/i.test(header.value);
      if (!hasSecure) {
        await requestContext.dispose();
        throw new Error(
          `Login response for ${email} is missing the Secure attribute on hope_session. ` +
            `Production auth (lib/auth.ts) must always set Secure on this cookie — global setup ` +
            `fails hard here rather than silently continuing, because that would mask a real ` +
            `regression in production cookie policy.`,
        );
      }
      const hasHttpOnly = /;\s*HttpOnly(?:;|$)/i.test(header.value);
      if (!hasHttpOnly) {
        await requestContext.dispose();
        throw new Error(`Login response for ${email} is missing the HttpOnly attribute on hope_session.`);
      }
      if (!/;\s*SameSite=Lax(?:;|$)/i.test(header.value)) {
        await requestContext.dispose();
        throw new Error(`Login response for ${email} does not set SameSite=Lax on hope_session.`);
      }

      const cookieValue = header.value.split(";")[0].split("=").slice(1).join("=");
      if (!cookieValue) {
        await requestContext.dispose();
        throw new Error(`Login succeeded for ${email} but hope_session cookie value is empty`);
      }
      await requestContext.dispose();
      return cookieValue;
    }
  }

  await requestContext.dispose();
  throw new Error(`Login succeeded for ${email} but no hope_session cookie was set`);
}

/**
 * Minimal JSON shape consumed by e2e/auth-helper.ts. Not a full Playwright
 * storageState — auth-helper.ts injects this cookie into each fresh context
 * itself via page.context().addCookies(), rather than loading storageState
 * directly, since storageState's domain-matching is unreliable for
 * loopback HTTP.
 */
function createStorageState(cookieValue: string): { cookies: Array<Record<string, unknown>> } {
  return {
    cookies: [
      {
        name: "hope_session",
        value: cookieValue,
        httpOnly: true,
        secure: false, // loopback HTTP test copy only — production keeps Secure
        sameSite: "Lax",
      },
    ],
  };
}
