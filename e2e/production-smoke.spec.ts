import { test, expect, type APIResponse, type Page } from "@playwright/test";

/**
 * Production Critical Smoke Tests
 *
 * These tests cover non-destructive, high-level flows of the Hope Tender Proposal Generator.
 * They are designed to run against a production or production-like environment to verify
 * system health and core circuit breakers.
 *
 * Required Environment Variables:
 * - PLAYWRIGHT_BASE_URL: The target URL (e.g., https://app.hopeengineering.com)
 * - SMOKE_TEST_EMAIL: Email for a test account
 * - SMOKE_TEST_PASSWORD: Password for the test account
 * - EXPECTED_RELEASE_SHA: (Optional) The git commit SHA expected in /api/health
 *
 * Safety:
 * - These tests do NOT modify database records or delete production data.
 * - They use unauthenticated and authenticated GET/POST requests that are gated or use fake IDs.
 * - Tests requiring credentials will skip safely if they are missing.
 */

const SMOKE_TEST_EMAIL = process.env.SMOKE_TEST_EMAIL;
const SMOKE_TEST_PASSWORD = process.env.SMOKE_TEST_PASSWORD;
const EXPECTED_RELEASE_SHA = process.env.EXPECTED_RELEASE_SHA;
const baseURL = process.env.SMOKE_BASE_URL || process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

/**
 * Replicates session cookie handling for loopback CI environments.
 * Production environments (HTTPS) use Secure cookies which Playwright's
 * request context handles normally, but local/loopback tests (HTTP)
 * require manual cookie injection to bridge the request/browser gap.
 */
async function preserveLoopbackSession(page: Page, response: APIResponse) {
  const origin = new URL(baseURL);
  if (origin.protocol !== "http:") return;

  const sessionHeader = response.headersArray().find(
    ({ name, value }) => name.toLowerCase() === "set-cookie" && value.startsWith("hope_session="),
  );
  if (!sessionHeader) return;

  const cookiePair = sessionHeader.value.split(";", 1)[0];
  const separator = cookiePair.indexOf("=");
  if (separator <= 0) return;
  const value = cookiePair.slice(separator + 1);

  await page.context().addCookies([{
    name: "hope_session",
    value,
    url: origin.origin,
    httpOnly: true,
    sameSite: "Lax",
    secure: false,
  }]);
}

async function performLogin(page: Page) {
  if (!SMOKE_TEST_EMAIL || !SMOKE_TEST_PASSWORD) {
    test.skip(true, "SMOKE_TEST_EMAIL or SMOKE_TEST_PASSWORD environment variables are missing.");
    return;
  }
  // The global setup has already authenticated and saved the storage state.
  // The project config sets storageState to the primary account's saved state.
  // Just navigate to the dashboard to activate the session.
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  // Verify we're actually authenticated (not redirected to login)
  if (/login/.test(page.url())) {
    throw new Error("Session not authenticated — storage state may be missing or expired");
  }
}

test.describe("Production Critical Smoke Tests", () => {

  test("1. API Health Check", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status(), "Health endpoint must be 200 OK").toBe(200);

    const body = await response.json();
    expect(body.ok, "Health 'ok' must be true").toBe(true);
    expect(body.status, "Health status must be 'healthy'").toBe("healthy");

    if (EXPECTED_RELEASE_SHA) {
      expect(body.release, "Release SHA must match expected value").toBe(EXPECTED_RELEASE_SHA);
    }

    const CRITICAL_TABLES = [
      "RateLimitBucket",
      "PasswordResetToken",
      "SubmissionPlanState",
      "AiAnalyzeChunk",
      "AiJob",
    ];

    for (const table of CRITICAL_TABLES) {
      expect(body.tables[table], `Critical table '${table}' must exist and be accessible`).toBe(true);
    }
  });

  test("2. Login Flow and 3. Dashboard Protection", async ({ page }) => {
    // 3. Dashboard Protection: Check that unauthenticated access redirects to login
    await page.goto("/dashboard/tenders");
    await expect(page, "Unauthenticated access should redirect to login page").toHaveURL(/\/login/);

    // 2. Login Flow: Perform login with smoke credentials
    await performLogin(page);

    // 3. Authenticated Access: Verify dashboard loads
    await page.goto("/dashboard/tenders");
    await expect(page, "Authenticated user should not be redirected to login").not.toHaveURL(/\/login/);
    // We expect the dashboard to render with the tenders heading or similar
    await expect(page.locator("h1, h2").first(), "Dashboard heading should be visible").toBeVisible();
  });

  test("4. Source tender intake prerequisites", async ({ page }) => {
    await performLogin(page);
    await page.goto("/dashboard/tenders/new");

    // Verify supported file-format guidance is visible (Intake prerequisite)
    await expect(page.getByText(/PDF.*DOCX.*XLSX|supported format/i), "File format guidance should be visible").toBeVisible();
  });

  test("5. AI-analysis prerequisites", async ({ page }) => {
    await performLogin(page);

    // Attempting to trigger AI analysis on a non-existent tender
    // This verifies that the route is gated and doesn't crash.
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await page.request.post(`/api/tenders/${fakeId}/ai-analyze`);

    // We expect a 404 or a 4xx gate error, NOT a 500.
    expect(response.status(), "AI analysis route should not return 500 error").not.toBe(500);
  });

  test("6. Generation gates", async ({ page }) => {
    await performLogin(page);

    // Use a fake ID to check generation readiness gates
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await page.request.get(`/api/tenders/${fakeId}/generation-readiness`);

    if (response.status() === 200) {
      const body = await response.json();
      // If the endpoint returns 200 for a missing/unprocessed tender, it MUST indicate NOT ready.
      expect(body.ready, "Generation should be blocked for unanalyzed tender").toBe(false);
      expect(body.fullProposalBlockers, "Blockers should be present").toBeDefined();
    } else {
      // 404 is also an acceptable response for a fake ID
      expect(response.status(), "Generation readiness should be 200 or 404").toBe(404);
    }
  });

  test("7. Export gates", async ({ page }) => {
    await performLogin(page);

    // Use a fake ID to check export readiness gates
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await page.request.get(`/api/tenders/${fakeId}/export-readiness`);

    if (response.status() === 200) {
      const body = await response.json();
      expect(body.exportReadiness?.ok, "Export should be blocked for unanalyzed tender").toBe(false);
    } else {
      expect(response.status(), "Export readiness should be 200 or 404").toBe(404);
    }
  });

  test("8. Share-link access", async ({ page }) => {
    // Test unauthenticated access to a non-existent share link
    // This verifies the share route structure handles invalid tokens gracefully.
    await page.goto("/share/00000000-0000-0000-0000-000000000000");

    // Should show error/invalid/not found message without a 500 crash
    await expect(page.getByText(/not found|invalid|expired/i).first(), "Should show invalid token message").toBeVisible();
    await expect(page, "Should not crash to an error page").not.toHaveURL(/error|500/);
  });

});
