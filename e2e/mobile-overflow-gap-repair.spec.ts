// Regression coverage for real horizontal-overflow gaps found during screenshot
// audits. The tender workspace now has one canonical status/next-action surface
// followed by five collapsed workflow stages; the removed Workflow Control
// Center must not be required for this test to exercise the live page.
import { primaryTest as test, expect, injectSavedSessionIntoContext } from "./auth-helper";
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
    await expect(page.getByText("Next required action", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Intake and extraction", { exact: true })).toBeVisible();
    await expect(page.getByText("Workflow Control Center", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Final Submission Control Center", { exact: true })).toHaveCount(0);
    await expectNoHorizontalScroll(page, `/dashboard/tenders/${SEEDED_PRIMARY_TENDER_ID}`);
  });

  test("Knowledge Vault (company) page has no horizontal overflow", async ({ page }) => {
    await visitAtMobileWidth(page, "/dashboard/company");
    await expect(page.getByRole("status").filter({ hasText: "Loading Company Vault" })).toBeHidden({ timeout: 15_000 });
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

test.describe("Mobile (390x844) overflow — long unbreakable submission email in Tender Detail", () => {
  let tenderId: string | null = null;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    await injectSavedSessionIntoContext(context, "primary-loopback.json");
    const page = await context.newPage();
    const form = new FormData();
    form.append("title", "Overflow Regression — Long Submission Email");
    form.append("reference", "RFP-OVERFLOW-EMAIL-REGRESSION-001");
    form.append("file", new Blob(["Long unbreakable submission email overflow regression fixture."], { type: "text/plain" }), "fixture.txt");
    const intake = await page.request.post("/api/tenders/upload-first", { multipart: form });
    if (intake.status() !== 201 && intake.status() !== 200) {
      throw new Error(`Overflow-email fixture creation failed: status=${intake.status()} body=${await intake.text()}`);
    }
    const json = (await intake.json()) as { tenderId: string };
    tenderId = json.tenderId;

    const override = await page.request.post(`/api/tenders/${tenderId}/metadata-override`, {
      data: {
        field: "submissionEmails",
        fieldState: "USER_CONFIRMED",
        overrideValue: "submissions-department-procurement-office@ministryofpublicworksandinfrastructure.example.test",
        reason: "Manually confirmed from the tender ToR cover page for overflow regression testing.",
        confirmationBasis: "SOURCE_DOCUMENT_CONFIRMED",
      },
    });
    if (override.status() !== 200) {
      throw new Error(`Overflow-email metadata-override failed: status=${override.status()} body=${await override.text()}`);
    }
    await context.close();
  });

  test.afterAll(async ({ browser }) => {
    if (!tenderId) return;
    const context = await browser.newContext();
    await injectSavedSessionIntoContext(context, "primary-loopback.json");
    const page = await context.newPage();
    await page.request.delete(`/api/tenders/${tenderId}`);
    await context.close();
  });

  test("tender detail page has no horizontal overflow with a long unbroken submission email", async ({ page }) => {
    await visitAtMobileWidth(page, `/dashboard/tenders/${tenderId}`);
    await expectNoHorizontalScroll(page, `/dashboard/tenders/${tenderId}`);
  });
});

test.describe("Mobile (390x844) overflow — pathologically long, unbroken tender title", () => {
  let tenderId: string | null = null;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    await injectSavedSessionIntoContext(context, "primary-loopback.json");
    const page = await context.newPage();
    const form = new FormData();
    form.append("title", "A".repeat(120));
    form.append("reference", "RFP-LONGTITLE-REGRESSION-001");
    form.append("file", new Blob(["Long unbroken title overflow regression fixture."], { type: "text/plain" }), "fixture.txt");
    const intake = await page.request.post("/api/tenders/upload-first", { multipart: form });
    if (intake.status() !== 201) {
      throw new Error(`Long-title fixture creation failed: status=${intake.status()} body=${await intake.text()}`);
    }
    const json = (await intake.json()) as { tenderId: string };
    tenderId = json.tenderId;
    await context.close();
  });

  test.afterAll(async ({ browser }) => {
    if (!tenderId) return;
    const context = await browser.newContext();
    await injectSavedSessionIntoContext(context, "primary-loopback.json");
    const page = await context.newPage();
    await page.request.delete(`/api/tenders/${tenderId}`);
    await context.close();
  });

  const routes = [
    ["dashboard overview (Live Pipeline table)", "/dashboard"],
    ["export card", "/dashboard/export"],
    ["matching dashboard", "/dashboard/matching"],
    ["documents page", "/dashboard/documents"],
    ["analysis table", "/dashboard/analysis"],
  ] as const;

  for (const [label, route] of routes) {
    test(`${label} has no horizontal overflow with a long unbroken title`, async ({ page }) => {
      await visitAtMobileWidth(page, route);
      if (route === "/dashboard/documents") {
        await expect(page.getByText("Review planned and generated submission outputs, validation status, review decisions, and canonical download readiness.")).toBeVisible({ timeout: 15_000 });
      }
      await expectNoHorizontalScroll(page, route);
    });
  }

  test("tender detail command-center has no horizontal overflow with a long unbroken title", async ({ page }) => {
    await visitAtMobileWidth(page, `/dashboard/tenders/${tenderId}/command-center`);
    await expectNoHorizontalScroll(page, `/dashboard/tenders/${tenderId}/command-center`);
  });

  test("tender report page has no horizontal overflow with a long unbroken title", async ({ page }) => {
    await visitAtMobileWidth(page, `/dashboard/tenders/${tenderId}/report`);
    await expectNoHorizontalScroll(page, `/dashboard/tenders/${tenderId}/report`);
  });
});
