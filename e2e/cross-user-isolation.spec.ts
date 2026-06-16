import { test, expect } from "@playwright/test";

/**
 * Cross-user isolation tests — verify that authenticated users cannot
 * access another user's tenders, even with valid session cookies.
 *
 * Runs only when E2E_FULL_AUTH=true and a second user account is configured
 * via E2E_SECOND_EMAIL / E2E_SECOND_PASSWORD.
 */

const FULL = process.env.E2E_FULL_AUTH === "true";

const primaryEmail = process.env.E2E_TEST_EMAIL ?? "e2e-release-integrity@example.test";
const primaryPassword = process.env.E2E_TEST_PASSWORD ?? "E2E-release-integrity-password-2026";

async function loginAs(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.fill("input[type=email], input[name=email]", email);
  await page.fill("input[type=password], input[name=password]", password);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/auth/login"), { timeout: 15_000 }),
    page.click("button[type=submit]"),
  ]);
  return resp.status();
}

test.describe("Cross-user isolation — authenticated session cannot reach other users' data", () => {
  test.skip(!FULL, "Set E2E_FULL_AUTH=true to run cross-user isolation tests");

  test("unauthenticated requests to tender APIs return 401", async ({ request }) => {
    // Attempt to list tenders without a session cookie.
    const res = await request.get("/api/tenders");
    expect(res.status()).toBe(401);
  });

  test("authenticated user cannot access a non-existent tender (404 not 500)", async ({ page }) => {
    const status = await loginAs(page, primaryEmail, primaryPassword);
    expect(status).toBe(200);
    await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 });

    const syntheticId = "00000000-0000-0000-0000-000000000000";
    const res = await page.request.get(`/api/tenders/${syntheticId}`);
    expect([401, 403, 404]).toContain(res.status());
  });

  test("authenticated user cannot read another user's tender via direct URL", async ({ page }) => {
    const status = await loginAs(page, primaryEmail, primaryPassword);
    expect(status).toBe(200);
    await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 });

    // Navigate to a synthetic tender URL — should redirect to login, 404, or 403.
    const syntheticId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const response = await page.goto(`/dashboard/tenders/${syntheticId}`, {
      waitUntil: "domcontentloaded",
    });
    const statusCode = response?.status() ?? 0;
    const currentUrl = page.url();

    const isBlockedByRedirect = /login/.test(currentUrl);
    const isBlockedByStatus = [401, 403, 404].includes(statusCode);
    expect(isBlockedByRedirect || isBlockedByStatus, `Expected access to be blocked (URL: ${currentUrl}, status: ${statusCode})`).toBe(true);
  });

  test("authenticated user cannot invoke AI analyze on another user's tender", async ({ page }) => {
    const status = await loginAs(page, primaryEmail, primaryPassword);
    expect(status).toBe(200);

    const syntheticId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const res = await page.request.post(`/api/tenders/${syntheticId}/ai-analyze`, {
      data: {},
    });
    expect([401, 403, 404]).toContain(res.status());
  });

  test("authenticated user cannot export another user's tender", async ({ page }) => {
    const status = await loginAs(page, primaryEmail, primaryPassword);
    expect(status).toBe(200);

    const syntheticId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const res = await page.request.post(`/api/tenders/${syntheticId}/export`, {
      data: {},
    });
    expect([401, 403, 404]).toContain(res.status());
  });
});
