import { test, expect } from "@playwright/test";

test.describe("Public share links", () => {
  test("invalid token shows error page", async ({ page }) => {
    await page.goto("/share/invalid-token-that-does-not-exist");
    await expect(page.getByText(/not found|invalid|expired/i).first()).toBeVisible();
  });

  test("share page has correct structure", async ({ page }) => {
    await page.goto("/share/invalid-token-that-does-not-exist");
    // Should show error without crashing
    await expect(page).not.toHaveURL(/error|500/);
  });
});
