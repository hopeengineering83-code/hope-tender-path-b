// Regression coverage for a real gap found during a screenshot audit: four
// routes had horizontal overflow at the 390x844 mobile viewport (a header
// row's action buttons pushed off-canvas, tab bars wider than the screen,
// an unbreakable <code> snippet, and a workflow-step title forcing its row
// wider than the viewport). None of these routes were covered by the
// existing OWNED_ROUTES overflow check in
// tablet-universal-tender-intelligence.spec.ts, so this file closes that
// coverage gap directly rather than folding dissimilar pages into that
// generic ADMIN/PROPOSAL_MANAGER-owned-routes list.
//
// The tender detail page's overflow depended on the specific stage/badge
// text a real analyzed tender accumulates, which a freshly-created tender
// does not reach — so this reuses the deterministic seeded "Primary Owner
// Fixture" tender (id 11111111-1111-4111-8111-111111111111, created by
// scripts/seed-e2e-user.mjs and already relied on by
// e2e/cross-user-isolation.spec.ts) rather than creating a new one.
import { primaryTest as test, expect } from "./auth-helper";
import type { Page } from "@playwright/test";

const SEEDED_PRIMARY_TENDER_ID = "11111111-1111-4111-8111-111111111111";

async function expectNoHorizontalScroll(page: Page, route: string) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    dimensions.scrollWidth,
    `${route} must not overflow horizontally at 390px (scrollWidth=${dimensions.scrollWidth}, clientWidth=${dimensions.clientWidth})`,
  ).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function visitAtMobileWidth(page: Page, route: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe("Mobile (390x844) overflow gap repair", () => {
  test("tender detail page has no horizontal overflow", async ({ page }) => {
    await visitAtMobileWidth(page, `/dashboard/tenders/${SEEDED_PRIMARY_TENDER_ID}`);
    await expectNoHorizontalScroll(page, `/dashboard/tenders/${SEEDED_PRIMARY_TENDER_ID}`);
  });

  test("Knowledge Vault (company) page has no horizontal overflow", async ({ page }) => {
    await visitAtMobileWidth(page, "/dashboard/company");
    await expectNoHorizontalScroll(page, "/dashboard/company");
  });

  test("Legacy Data Import page has no horizontal overflow", async ({ page }) => {
    await visitAtMobileWidth(page, "/dashboard/company/plan-b-import");
    await expectNoHorizontalScroll(page, "/dashboard/company/plan-b-import");
  });

  test("Export Hub page has no horizontal overflow", async ({ page }) => {
    await visitAtMobileWidth(page, "/dashboard/export");
    await expectNoHorizontalScroll(page, "/dashboard/export");
  });
});
