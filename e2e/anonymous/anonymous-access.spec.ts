/**
 * Anonymous (unauthenticated) Playwright tests.
 *
 * These tests run in the "chromium-anonymous" and "samsung-tablet-anonymous"
 * projects which have NO storage state — no session cookie. They verify
 * that unauthenticated users are redirected to login and cannot access
 * protected resources.
 *
 * Authenticated tests are in separate files in the parent e2e/ directory
 * and run in the "chromium-primary" / "samsung-tablet-primary" projects
 * which have the authenticated storage state.
 */

import { test, expect } from "@playwright/test";

test.describe("anonymous access — desktop and tablet", () => {
  test("home page renders without a server error", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(page.url()).not.toMatch(/\/error/);
  });

  test("login page renders without a server error", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("input[type=email], input[name=email]")).toBeVisible({ timeout: 10_000 });
  });

  test("unauthenticated dashboard access is blocked", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test("unauthenticated /dashboard/tenders access is blocked", async ({ page }) => {
    await page.goto("/dashboard/tenders");
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test("unauthenticated admin routes never expose admin UI", async ({ page }) => {
    for (const route of ["/dashboard/admin", "/dashboard/admin/ai-readiness", "/dashboard/users"]) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page, route).toHaveURL(/\/login/, { timeout: 10_000 });
      await expect(page.getByRole("heading", { name: /AI Readiness|User Management/i })).toHaveCount(0);
    }
  });

  test("protected tender APIs never return anonymous success", async ({ request }) => {
    const endpoints: Array<["get" | "post", string]> = [
      ["post", "/api/tenders/upload-first"],
      ["post", "/api/tenders/fake-id/ai-analyze"],
      ["post", "/api/tenders/fake-id/generate"],
      ["post", "/api/tenders/fake-id/export"],
      ["get", "/api/tenders/fake-id/extraction-quality"],
    ];
    for (const [method, endpoint] of endpoints) {
      const response = method === "get" ? await request.get(endpoint) : await request.post(endpoint);
      expect(response.status(), `${method.toUpperCase()} ${endpoint}`).not.toBeLessThan(300);
    }
  });

  test("API Health Check works without authentication", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status(), "Health endpoint must be 200 OK").toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
  });
});
