// End-to-end regression coverage for the canonical workflow shortcuts.
//
// The retired embedded Workflow Control Center was removed because it competed
// with the Next Required Action card and duplicated stage mutations. The full
// ten-step workflow now lives in a disclosure inside that canonical card. Each
// shortcut must still find its owning panel, open every closed parent <details>,
// and scroll the target into view.

import { primaryTest as test, expect } from "./auth-helper";
import type { Locator, Page } from "@playwright/test";

const SEEDED_PRIMARY_TENDER_ID = "11111111-1111-4111-8111-111111111111";

const STAGE_LINKS: Array<[stage: number, linkText: string, targetSelector: string]> = [
  [1, "Source Files", "#tender-files"],
  [2, "Extraction Quality", "#extraction-quality"],
  [3, "AI Analyze", "#ai-analyze-section"],
  [4, "Confirm Requirements", "#requirement-coverage"],
  [5, "Tender Details", "#tender-edit-form"],
  [6, "Verified Submission Plan", "#submission-plan"],
  [7, "Match Evidence", "#match-evidence"],
  [8, "Generate Documents", "#generated-documents"],
  [9, "Validate and Approve", "#authority-review"],
  [10, "Export ZIP", "#export-readiness"],
];

async function expectTargetOpenedAndInView(page: Page, target: Locator) {
  await expect(target).toBeVisible({ timeout: 15_000 });

  const parentDetailsOpen = await target.evaluate((element) => {
    let parent = element.parentElement;
    while (parent) {
      if (parent instanceof HTMLDetailsElement && !parent.open) return false;
      parent = parent.parentElement;
    }
    return true;
  });
  expect(parentDetailsOpen, "the shortcut must open every parent disclosure").toBe(true);

  await expect.poll(async () => target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  }), { timeout: 5_000 }).toBe(true);
}

test.describe("Canonical full-workflow shortcuts interlink every stage", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/dashboard/tenders/${SEEDED_PRIMARY_TENDER_ID}`, { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText("Next required action", { exact: false }).first()).toBeVisible({ timeout: 15_000 });

    // The duplicate control centers must remain absent from the normal page.
    await expect(page.getByRole("heading", { name: "Workflow Control Center" })).toHaveCount(0);
    await expect(page.getByText("Final Submission Control Center", { exact: true })).toHaveCount(0);

    const workflowDisclosure = page.locator("summary", { hasText: "View full workflow" }).first();
    await workflowDisclosure.click();
    await expect(page.getByRole("navigation", { name: "Full tender workflow" })).toBeVisible();

    for (const [, , selector] of STAGE_LINKS) {
      await expect(page.locator(selector).first()).toBeAttached({ timeout: 15_000 });
    }
  });

  for (const [stage, linkText, targetSelector] of STAGE_LINKS) {
    test(`stage ${stage} ("${linkText}") opens and scrolls to ${targetSelector}`, async ({ page }) => {
      const workflowNav = page.getByRole("navigation", { name: "Full tender workflow" });
      const link = workflowNav.getByRole("link", { name: linkText, exact: true });
      const target = page.locator(targetSelector).first();

      await page.evaluate(() => window.scrollTo(0, 0));
      await link.click();
      await expectTargetOpenedAndInView(page, target);
    });
  }
});
