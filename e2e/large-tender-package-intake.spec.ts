import { primaryTest as test, expect } from "./auth-helper";

const SEEDED_PRIMARY_TENDER_ID = "11111111-1111-4111-8111-111111111111";

function packageFiles(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    name: `package-document-${String(index + 1).padStart(2, "0")}.txt`,
    mimeType: "text/plain",
    buffer: Buffer.from(`Large tender package fixture ${index + 1}`),
  }));
}

test.describe("large tender package intake", () => {
  test("an 11-file package creates once, appends one request-safe batch, and reconciles on the tender", async ({ page }) => {
    let createCalls = 0;
    let appendCalls = 0;

    await page.route("**/api/tenders/upload-first", async (route) => {
      createCalls += 1;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ success: true, tenderId: SEEDED_PRIMARY_TENDER_ID, uploadedFiles: 10 }),
      });
    });
    await page.route("**/api/upload", async (route) => {
      appendCalls += 1;
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          uploaded: 1,
          errors: 0,
          results: [{ success: true, fileRecord: { id: "mock-appended-file" } }],
        }),
      });
    });

    await page.goto("/dashboard/tenders/new", { waitUntil: "domcontentloaded" });
    const input = page.locator('input[type="file"][multiple]').first();
    await input.setInputFiles(packageFiles(11));

    await expect(page.getByText(/11 of 50 files selected/)).toBeVisible();
    await expect(page.getByText(/2 secure batches/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Tender from 11 Documents" })).toBeEnabled();

    await page.getByRole("button", { name: "Create Tender from 11 Documents" }).click();
    await expect.poll(() => createCalls).toBe(1);
    await expect.poll(() => appendCalls).toBe(1);
    await expect(page).toHaveURL(new RegExp(`/dashboard/tenders/${SEEDED_PRIMARY_TENDER_ID}\\?packageIntake=1&packageFailed=0`));

    await expect(page.getByText("Large tender package intake completed", { exact: true })).toBeVisible();
    await expect(page.getByText(/Confirm that every selected document appears below before running AI Analyze/)).toBeVisible();
    await expect(page.getByText(/per-request security limits remained unchanged/)).toBeVisible();
  });

  test("a failed append batch preserves the created tender and shows an actionable reconciliation warning", async ({ page }) => {
    let createCalls = 0;
    let appendCalls = 0;

    await page.route("**/api/tenders/upload-first", async (route) => {
      createCalls += 1;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ success: true, tenderId: SEEDED_PRIMARY_TENDER_ID, uploadedFiles: 10 }),
      });
    });
    await page.route("**/api/upload", async (route) => {
      appendCalls += 1;
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          uploaded: 0,
          errors: 1,
          results: [{ success: false, error: "Mock append failure" }],
        }),
      });
    });

    await page.goto("/dashboard/tenders/new", { waitUntil: "domcontentloaded" });
    await page.locator('input[type="file"][multiple]').first().setInputFiles(packageFiles(11));
    await page.getByRole("button", { name: "Create Tender from 11 Documents" }).click();

    await expect.poll(() => createCalls).toBe(1);
    await expect.poll(() => appendCalls).toBe(1);
    await expect(page).toHaveURL(new RegExp(`/dashboard/tenders/${SEEDED_PRIMARY_TENDER_ID}\\?packageIntake=1&packageFailed=1`));
    await expect(page.getByRole("alert").filter({ hasText: "Large tender package intake completed" })).toBeVisible();
    await expect(page.getByText(/1 additional file\(s\) could not be uploaded/)).toBeVisible();
    await expect(page.getByText(/select those files again below/)).toBeVisible();
  });

  test("large-package selection stays usable at a 390px viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard/tenders/new", { waitUntil: "domcontentloaded" });
    await page.locator('input[type="file"][multiple]').first().setInputFiles(packageFiles(11));

    await expect(page.getByText(/11 of 50 files selected/)).toBeVisible();
    const action = page.getByRole("button", { name: "Create Tender from 11 Documents" });
    expect((await action.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  });
});
