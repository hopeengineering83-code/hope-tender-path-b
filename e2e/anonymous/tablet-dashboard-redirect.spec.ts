import { test, expect } from "@playwright/test";

/**
 * Relocated from tablet-universal-tender-intelligence.spec.ts: this test
 * verifies unauthenticated (anonymous) redirect behavior, not authenticated
 * tablet UX, so it belongs in the anonymous suite. It runs under both
 * chromium-anonymous (desktop viewport) and samsung-tablet-anonymous
 * (800x1280), matching how every other anonymous spec runs across viewports.
 */

async function expectNoHorizontalScroll(page: import("@playwright/test").Page) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth, `Page must not overflow horizontally (scrollWidth=${scrollWidth}, clientWidth=${clientWidth})`).toBeLessThanOrEqual(clientWidth + 1); // +1 for rounding
}

test("dashboard redirects to login when unauthenticated (no horizontal overflow)", async ({ page }) => {
  await page.goto("/dashboard/tenders");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(/\/login/);
  await expectNoHorizontalScroll(page);
});
