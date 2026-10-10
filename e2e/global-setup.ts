/**
 * Playwright global setup — authenticates the CI-seeded primary and secondary
 * accounts ONCE EACH via the real /api/auth/login endpoint, then writes the
 * minimum loopback cookie state required by authenticated fixtures.
 *
 * Credentials and account identifiers are never included in thrown errors.
 * The API request context sends the same Origin and Referer a same-origin
 * browser form would send, so strict CSRF remains enabled in CI.
 */

import { type FullConfig, request as playwrightRequest } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const STORAGE_DIR = join(process.cwd(), ".auth");
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const baseOrigin = new URL(baseURL).origin;

const primaryEmail = process.env.E2E_TEST_EMAIL ?? "e2e-primary@example.test";
const primaryPassword = process.env.E2E_TEST_PASSWORD ?? "";
const secondaryEmail = process.env.E2E_SECOND_EMAIL ?? "e2e-secondary@example.test";
const secondaryPassword = process.env.E2E_SECOND_PASSWORD ?? "";

export default async function globalSetup(_config: FullConfig) {
  mkdirSync(STORAGE_DIR, { recursive: true });

  if (primaryPassword) {
    const cookie = await loginAndGetCookie("primary", primaryEmail, primaryPassword);
    writeFileSync(join(STORAGE_DIR, "primary-loopback.json"), JSON.stringify(createStorageState(cookie)));
  }

  if (secondaryPassword) {
    const cookie = await loginAndGetCookie("secondary", secondaryEmail, secondaryPassword);
    writeFileSync(join(STORAGE_DIR, "secondary-loopback.json"), JSON.stringify(createStorageState(cookie)));
  }
}

async function loginAndGetCookie(accountLabel: "primary" | "secondary", email: string, password: string): Promise<string> {
  const requestContext = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: {
      Origin: baseOrigin,
      Referer: `${baseOrigin}/login`,
      Accept: "application/json",
    },
  });

  const response = await requestContext.post("/api/auth/login", {
    data: { email, password },
  });

  if (response.status() !== 200) {
    const requestId = response.headers()["x-request-id"];
    await requestContext.dispose();
    throw new Error(
      `Isolated ${accountLabel} login fixture failed: status=${response.status()}` +
      (requestId ? ` requestId=${requestId}` : ""),
    );
  }

  const setCookieHeaders = response.headersArray().filter(
    (header) => header.name.toLowerCase() === "set-cookie",
  );

  for (const header of setCookieHeaders) {
    if (!header.value.startsWith("hope_session=")) continue;

    if (!/;\s*Secure(?:;|$)/i.test(header.value)) {
      await requestContext.dispose();
      throw new Error(
        `Isolated ${accountLabel} login response is missing Secure on hope_session.`,
      );
    }
    if (!/;\s*HttpOnly(?:;|$)/i.test(header.value)) {
      await requestContext.dispose();
      throw new Error(
        `Isolated ${accountLabel} login response is missing HttpOnly on hope_session.`,
      );
    }
    if (!/;\s*SameSite=Lax(?:;|$)/i.test(header.value)) {
      await requestContext.dispose();
      throw new Error(
        `Isolated ${accountLabel} login response is missing SameSite=Lax on hope_session.`,
      );
    }

    const cookieValue = header.value.split(";")[0].split("=").slice(1).join("=");
    if (!cookieValue) {
      await requestContext.dispose();
      throw new Error(`Isolated ${accountLabel} login returned an empty hope_session cookie.`);
    }
    await requestContext.dispose();
    return cookieValue;
  }

  await requestContext.dispose();
  throw new Error(`Isolated ${accountLabel} login did not set hope_session.`);
}

function createStorageState(cookieValue: string): { cookies: Array<Record<string, unknown>> } {
  return {
    cookies: [
      {
        name: "hope_session",
        value: cookieValue,
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ],
  };
}
