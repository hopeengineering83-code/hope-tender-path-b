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
    // The disclosure's initial state is a product preference, not part of this
    // overflow contract. Some release branches keep Quick workflow control
    // open while others collapse the optional panel. Open it only when needed
    // so this test never closes an already-visible Workflow Control Center.
    const quickWorkflowGroup = page
      .getByRole("group")
      .filter({ hasText: "Quick workflow control" })
      .first();
    const isOpen = await quickWorkflowGroup.evaluate(
      (element) => (element as HTMLDetailsElement).open,
    );
    if (!isOpen) await quickWorkflowGroup.locator("summary").click();
    await expect(page.getByRole("heading", { name: "Workflow Control Center" })).toBeVisible({ timeout: 20_000 });
    await expectNoHorizontalScroll(page, `/dashboard/tenders/${SEEDED_PRIMARY_TENDER_ID}`);
  });

  test("Knowledge Vault (company) page has no horizontal overflow", async ({ page }) => {
    await visitAtMobileWidth(page, "/dashboard/company");
    // The page renders "Loading Company Vault…" (role="status", but with no
    // aria-label/aria-labelledby — a name-filtered getByRole("status", {name})
    // matches nothing even while it's genuinely showing, making toBeHidden()
    // pass vacuously) until its client-side fetch resolves, then swaps in the
    // repaired tab bar. Filter the unnamed status role by its text instead so
    // this actually waits for the real loader to disappear.
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
  // Found via a screenshot recheck: the Tender Detail fact grid's value
  // column (tender-intake-detail-panel.tsx's Detail() helper) is a flex
  // child with `flex-1` but no `min-w-0`, so a long unbreakable value
  // (e.g. a submissionEmails address) refuses to shrink below its own
  // content width and pushes the whole page 29px past the 390px viewport.
  // `min-w-0` + `break-words` on that div fixes it without touching the
  // scroll-clipped tables elsewhere on the same page (those already have
  // their own overflow-x-auto wrapper and are unaffected by this bug).
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
  // Found via automated PR review (codex) on a prior revision of this file:
  // a tender title with no whitespace (e.g. a long procurement identifier —
  // titles up to 120 chars are permitted at creation) is not wrapped by
  // `break-words` alone in most of these contexts. Two distinct root causes
  // were found and fixed:
  //   1. Several card/table title elements had no `break-words`/`min-w-0` at
  //      all (export card, matching/documents cards, command-center and
  //      report headings, analysis/list tables).
  //   2. The dashboard overview's "Live Pipeline" table sits inside a CSS
  //      Grid (`grid ... xl:grid-cols-[...]`) with no `grid-template-columns`
  //      override below the `xl` breakpoint — the browser's default `auto`
  //      grid track sizes to content, so the long word's min-content width
  //      propagated all the way up through the grid track itself. No amount
  //      of fixing the table (table-fixed, overflow-x-auto, break-words) had
  //      any effect until the grid got an explicit `grid-cols-1` (=
  //      `minmax(0, 1fr)`) base class. This is the more instructive bug of
  //      the two — a descendant's `overflow`/`break-words` cannot compensate
  //      for an ancestor flex/grid item's default `min-width: auto`.
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
    // Fail hard (not test.skip) on a non-201 response — a silent skip here
    // would let CI go green while exercising none of this file's long-title
    // regression coverage, masking a real upload-first/auth/DB regression.
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
        // DocumentsPage fetches its tender/document list client-side and
        // renders a SkeletonTable + "Loading planned and generated
        // documents…" subtitle until it resolves — wait for the real
        // (current) subtitle so a slow response can't leave this measuring
        // the skeleton instead of the repaired card. Text below was
        // reworded by a donor PR ("and generated" added, ending changed to
        // "canonical download readiness"); matched to current copy.
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
