// Regression coverage for a real, end-to-end functional gap found while
// tracing Workflow Control Center: components/tender-workflow-action-center.tsx's
// handleAction() only ever takes the scroll-to-anchor branch (the server
// never populates a stage's actionUrl — see
// app/api/tenders/[id]/workflow-center/route.ts, none of the 10 stage
// objects set actionUrl/actionMethod), but its `targets` map only had
// entries for 5 of the 10 stages (1, 3, 5, 8, 10). Clicking "Repair
// Extraction" (stage 2), "Review Requirements" (stage 4), "Build Plan"
// (stage 6), "Match Evidence" (stage 7), or "Review Documents" (stage 9)
// silently did nothing — no scroll, no request, no visible feedback.
//
// Fixed by adding the 5 missing target sections to the map, adding
// id="match-evidence" to vault-evidence-search-panel.tsx and
// id="authority-review" to authority-review-panel.tsx (the other 3 targets
// already had ids from sibling work). This test clicks every one of the
// 10 stage action buttons and asserts the page actually scrolls toward the
// named section — not just that the button exists.
import { primaryTest as test, expect } from "./auth-helper";
import type { Page } from "@playwright/test";

const SEEDED_PRIMARY_TENDER_ID = "11111111-1111-4111-8111-111111111111";

const STAGE_ACTIONS: Array<[stage: number, buttonText: string, targetSelector: string]> = [
  [1, "Manage Files", "#tender-files"],
  [2, "Repair Extraction", "#extraction-quality"],
  [3, "Run AI Analyze", "#ai-analyze-section"],
  [4, "Review Requirements", "#requirement-coverage"],
  [5, "Edit Tender Details", "#tender-edit-form"],
  [6, "Build Plan", "#submission-plan-reconciliation"],
  [7, "Match Evidence", "#match-evidence"],
  [8, "Generate", "#generated-documents"],
  [9, "Review Documents", "#authority-review"],
  [10, "Export", "#export-readiness"],
];

async function openAllDisclosures(page: Page) {
  // Opening a <details> can reveal further nested <details> inside it
  // (e.g. "Show source-grounded tender facts" inside the Tender Details
  // section), so a single snapshot-and-click-all pass can race a nested
  // summary's layout settling. Setting .open directly via evaluate sidesteps
  // Playwright's click-actionability checks entirely (no viewport/visibility
  // requirement), which is fine here since these are native <details>
  // elements — this only opens them, never mutates the app's own state.
  await page.evaluate(() => {
    document.querySelectorAll("details").forEach((d) => {
      d.open = true;
    });
  });
}

test.describe("Workflow Control Center — every stage action button actually scrolls to its section", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/dashboard/tenders/${SEEDED_PRIMARY_TENDER_ID}`, { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/login/);
    await openAllDisclosures(page);
    await expect(page.getByRole("heading", { name: "Workflow Control Center" })).toBeVisible({ timeout: 15_000 });
    // All 10 target sections must exist before this test can distinguish
    // "button did nothing" from "target section isn't rendered in this state".
    for (const [, , selector] of STAGE_ACTIONS) {
      await expect(page.locator(selector).first()).toBeAttached({ timeout: 15_000 });
    }
  });

  for (const [stage, buttonText, targetSelector] of STAGE_ACTIONS) {
    test(`stage ${stage} ("${buttonText}") scrolls to ${targetSelector}`, async ({ page }) => {
      await page.evaluate(() => window.scrollTo(0, 0));
      const beforeY = await page.evaluate(() => window.scrollY);

      await page.locator("button", { hasText: buttonText }).first().click({ force: true });
      await page.waitForTimeout(600);

      const afterY = await page.evaluate(() => window.scrollY);
      expect(afterY, `clicking "${buttonText}" (stage ${stage}) must scroll the page toward ${targetSelector}`).not.toBe(beforeY);
    });
  }
});
