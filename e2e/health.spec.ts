import { test, expect } from "@playwright/test";

test.describe("App health", () => {
  test("home page loads without 500", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).not.toBe(500);
  });

  test("login page loads without 500", async ({ page }) => {
    const response = await page.goto("/login");
    expect(response?.status()).not.toBe(500);
  });

  test("API health: deadline alerts returns 401 without secret", async ({ page }) => {
    const response = await page.request.get("/api/cron/deadline-alerts");
    expect(response.status()).toBe(401);
  });
});
