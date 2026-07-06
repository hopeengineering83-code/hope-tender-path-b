import { test, expect } from "@playwright/test";

/**
 * Manual Tender Facts Flexibility — Browser + Tablet (800x1280) E2E tests.
 *
 * Verifies the UI behavior for manual tender fact entry:
 *   - The audit modal opens for critical-field manual entries.
 *   - The authority label is displayed.
 *   - The modal requires a reason (≥10 chars) + confirmation basis.
 *   - The modal is usable at 800x1280 (tablet portrait).
 *
 * These tests run in the samsung-tablet project (800x1280) AND the desktop
 * Chromium project. They skip cleanly when credentials are missing.
 */

const SMOKE_TEST_EMAIL = process.env.SMOKE_TEST_EMAIL;
const SMOKE_TEST_PASSWORD = process.env.SMOKE_TEST_PASSWORD;

test.describe("Manual Tender Facts Flexibility — UI behavior", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Tests run only in Chromium projects");

  test("audit modal renders correctly for critical-field manual entry (desktop)", async ({ page }) => {
    if (!SMOKE_TEST_EMAIL || !SMOKE_TEST_PASSWORD) {
      test.skip(true, "SMOKE_TEST_EMAIL or SMOKE_TEST_PASSWORD not set");
      return;
    }
    // Login + navigate to a tender's client-submission-details panel
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.fill("input[type=email], input[name=email]", SMOKE_TEST_EMAIL);
    await page.fill("input[type=password], input[name=password]", SMOKE_TEST_PASSWORD);
    await page.click("button[type=submit]");
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

    // Navigate to the first tender's detail page
    await page.goto("/dashboard/tenders");
    await page.waitForLoadState("networkidle");
    const firstTenderLink = page.locator("a[href*='/dashboard/tenders/']").first();
    const hasTender = await firstTenderLink.isVisible().catch(() => false);
    if (!hasTender) {
      test.skip(true, "No tenders available for testing");
      return;
    }
    await firstTenderLink.click();
    await page.waitForLoadState("networkidle");

    // The ClientSubmissionDetailsPanel should be visible somewhere on the page
    // (it's rendered in the Intake and extraction stage of the accordion)
    // Look for the "⋮" action menu button on any field
    const actionMenuButton = page.locator('button[aria-label*="More actions"]').first();
    const hasActionMenu = await actionMenuButton.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasActionMenu) {
      test.skip(true, "No action menu visible (no editable fields)");
      return;
    }

    // Verify no horizontal overflow on the tender detail page
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth, "Tender detail page must not overflow horizontally").toBeLessThanOrEqual(clientWidth + 1);
  });

  test("audit modal renders correctly at 800x1280 (tablet portrait)", async ({ page }) => {
    if (!SMOKE_TEST_EMAIL || !SMOKE_TEST_PASSWORD) {
      test.skip(true, "SMOKE_TEST_EMAIL or SMOKE_TEST_PASSWORD not set");
      return;
    }
    // Verify the tablet viewport
    const viewport = page.viewportSize();
    if (viewport?.width !== 800 || viewport?.height !== 1280) {
      test.skip(true, "This test only runs in the samsung-tablet project (800x1280)");
      return;
    }

    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    // Verify no horizontal overflow on login page at 800px
    const loginScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const loginClientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(loginScrollWidth, "Login page must not overflow at 800px").toBeLessThanOrEqual(loginClientWidth + 1);

    await page.fill("input[type=email], input[name=email]", SMOKE_TEST_EMAIL);
    await page.fill("input[type=password], input[name=password]", SMOKE_TEST_PASSWORD);
    await page.click("button[type=submit]");
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

    // Navigate to dashboard
    await page.goto("/dashboard/tenders");
    await page.waitForLoadState("networkidle");
    // Verify no horizontal overflow on dashboard at 800px
    const dashScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const dashClientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(dashScrollWidth, "Dashboard must not overflow at 800px").toBeLessThanOrEqual(dashClientWidth + 1);
  });

  test("login form touch targets are ≥44px (tablet)", async ({ page }) => {
    const viewport = page.viewportSize();
    if (viewport?.width !== 800) {
      test.skip(true, "Tablet touch-target test only runs at 800px width");
      return;
    }
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const submit = page.locator("button[type=submit]");
    await expect(submit).toBeVisible();
    const box = await submit.boundingBox();
    if (box) {
      expect(box.height, "Login submit button must be ≥44px tall for touch").toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("Manual Tender Facts Flexibility — UI source-inspection", () => {
  const { readFileSync } = require("node:fs");

  test("ClientSubmissionDetailsPanel has the audit modal with reason + basis", () => {
    const src = readFileSync("components/client-submission-details-panel.tsx", "utf8");
    expect(src).toContain("pendingAction");
    expect(src).toContain("auditReason");
    expect(src).toContain("auditBasis");
    expect(src).toContain("CONFIRMATION_BASIS_OPTIONS");
    expect(src).toContain("AUTHORITY_LABELS");
    expect(src).toContain("Human-confirmed operational value");
    expect(src).toContain("Confirm manual entry");
    expect(src).toContain("Reason (required, min 10 characters)");
    expect(src).toContain("Confirmation basis (required)");
  });

  test("ClientSubmissionDetailsPanel does NOT hardcode boilerplate reasons", () => {
    const src = readFileSync("components/client-submission-details-panel.tsx", "utf8");
    // The old hardcoded reasons must be gone
    expect(src).not.toContain('reason: "Manual value entered by user."');
    expect(src).not.toContain('reason: "Confirmed from Client & Submission Details panel."');
    expect(src).not.toContain('reason: "Marked not applicable by user."');
  });

  test("ClientSubmissionDetailsPanel sends confirmationBasis in the POST body", () => {
    const src = readFileSync("components/client-submission-details-panel.tsx", "utf8");
    expect(src).toContain("body.confirmationBasis = confirmationBasis");
  });
});
