import { tabletPrimaryTest as test, expect } from "./auth-helper";
import type { Page } from "@playwright/test";

async function expectNoHorizontalScroll(page: Page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    dimensions.scrollWidth,
    `Page must not overflow horizontally (scrollWidth=${dimensions.scrollWidth}, clientWidth=${dimensions.clientWidth})`,
  ).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function expectTouchTargetSize(locator: import("@playwright/test").Locator, label = "touch target") {
  const box = await locator.boundingBox();
  if (!box) return;
  expect(box.height, `${label} must be at least 44px tall (got ${box.height})`).toBeGreaterThanOrEqual(44);
}

async function settleOwnedRoute(page: Page, route: string) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  await expect(page).not.toHaveURL(/\/login/);
}

const OWNED_ROUTES = [
  "/dashboard/settings",
  "/dashboard/assets",
  "/dashboard/setup",
  "/dashboard/calendar",
  "/dashboard/analytics",
  "/dashboard/search",
  "/dashboard/users",
] as const;

const OWNED_ROUTE_HEADINGS: Record<(typeof OWNED_ROUTES)[number], RegExp> = {
  "/dashboard/settings": /^Settings$/,
  "/dashboard/assets": /^Brand Assets$/,
  "/dashboard/setup": /^Company Setup Wizard$/,
  "/dashboard/calendar": /^Deadline Calendar$/,
  "/dashboard/analytics": /^Analytics$/,
  "/dashboard/search": /^Search$/,
  "/dashboard/users": /^User Management$/,
};

test.describe("Tablet and responsive dashboard contracts", () => {
  test.skip(({ page }) => {
    const size = page.viewportSize();
    return !size || size.width !== 800 || size.height !== 1280;
  }, "Responsive authenticated tests run only in the samsung-tablet project");

  test("viewport is 800x1280 (tablet form factor)", async ({ page }) => {
    await page.goto("/login");
    expect(page.viewportSize()).toEqual({ width: 800, height: 1280 });
  });

  test("login page fits in 800x1280 without horizontal scroll", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await expectNoHorizontalScroll(page);
    await expect(page.locator("input[type=email], input[name=email]")).toBeVisible();
    await expect(page.locator("input[type=password], input[name=password]")).toBeVisible();
    const submit = page.locator("button[type=submit]");
    await expect(submit).toBeVisible();
    await expectTouchTargetSize(submit, "login submit button");
  });

  test("login form submit button is touch-friendly", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const submit = page.locator("button[type=submit]");
    await expect(submit).toBeVisible();
    await expectTouchTargetSize(submit, "login submit button");
  });

  test("share-link page renders within 800px width", async ({ page }) => {
    await page.goto("/share/00000000-0000-0000-0000-000000000000");
    await page.waitForLoadState("networkidle");
    await expectNoHorizontalScroll(page);
    await expect(page.getByText(/not found|invalid|expired/i).first()).toBeVisible();
  });

  test("authenticated dashboard fits at 800px width", async ({ page }) => {
    await settleOwnedRoute(page, "/dashboard/tenders");
    await expectNoHorizontalScroll(page);
  });

  test("tender intake page is usable at 800px", async ({ page }) => {
    await settleOwnedRoute(page, "/dashboard/tenders/new");
    await expectNoHorizontalScroll(page);
    await expect(page.getByText(/PDF, DOCX, XLSX, TXT, and CSV/i)).toBeVisible();
  });

  test("touch targets on the tender intake page are at least 44px", async ({ page }) => {
    await settleOwnedRoute(page, "/dashboard/tenders/new");
    const buttons = page.locator("button:visible");
    const count = await buttons.count();
    for (let index = 0; index < Math.min(count, 5); index += 1) {
      await expectTouchTargetSize(buttons.nth(index), `button #${index}`);
    }
  });

  test("no horizontal overflow on the tender list page", async ({ page }) => {
    await settleOwnedRoute(page, "/dashboard/tenders");
    await expectNoHorizontalScroll(page);
    await expect(page.getByRole("heading", { name: "Tenders", exact: true })).toBeVisible();
  });

  test("portrait orientation remains active", async ({ page }) => {
    await page.goto("/login");
    expect(page.viewportSize()).toEqual({ width: 800, height: 1280 });
  });

  test("health endpoint is reachable from the tablet context", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });

  test("no page errors on login page", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      if (!error.message.includes("favicon")) errors.push(error.message);
    });
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    expect(errors, `Page errors on login page: ${errors.join("; ")}`).toEqual([]);
  });

  test("tender list cards are touch-tappable", async ({ page }) => {
    await settleOwnedRoute(page, "/dashboard/tenders");
    await expectNoHorizontalScroll(page);
    const cards = page.locator("a[href*='/dashboard/tenders/']:visible");
    const count = await cards.count();
    for (let index = 0; index < Math.min(count, 3); index += 1) {
      await expectTouchTargetSize(cards.nth(index), `tender card #${index}`);
    }
  });

  for (const viewport of [
    { width: 390, height: 844, name: "mobile" },
    { width: 1024, height: 1366, name: "tablet" },
    { width: 1440, height: 1000, name: "desktop" },
  ]) {
    test(`${viewport.name} owned routes have no page overflow and one active navigation item`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const route of OWNED_ROUTES) {
        await settleOwnedRoute(page, route);
        await expect(page.getByRole("heading", { name: OWNED_ROUTE_HEADINGS[route] }).first()).toBeVisible();
        await expectNoHorizontalScroll(page);

        if (viewport.width < 1280) {
          const opener = page.getByRole("button", { name: "Open navigation" });
          await expect(opener).toBeVisible();
          await opener.click();
          const drawer = page.getByRole("dialog", { name: "Hope Tender" });
          await expect(drawer).toBeVisible();
          await expect(drawer.locator('[aria-current="page"]')).toHaveCount(1);
          await page.getByRole("button", { name: "Close navigation" }).last().click();
          await expect(drawer).toBeHidden();
        } else {
          const navigation = page.getByRole("navigation", { name: "Primary navigation" });
          await expect(navigation).toBeVisible();
          await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
        }
      }
    });
  }

  test("owned primary controls remain visible and touch-sized", async ({ page }) => {
    const checks: Array<{ route: string; locator: () => import("@playwright/test").Locator }> = [
      { route: "/dashboard/settings", locator: () => page.getByRole("button", { name: "Save presentation defaults" }) },
      { route: "/dashboard/assets", locator: () => page.getByRole("button", { name: /Upload file|Replace/ }).first() },
      { route: "/dashboard/setup", locator: () => page.getByRole("button", { name: "Save and continue" }) },
      { route: "/dashboard/calendar", locator: () => page.getByRole("button", { name: "Previous month" }) },
      { route: "/dashboard/search", locator: () => page.getByRole("searchbox", { name: "Search tenders, experts, and projects" }) },
      { route: "/dashboard/users", locator: () => page.getByRole("button", { name: "Invite user" }) },
    ];

    await page.setViewportSize({ width: 390, height: 844 });
    for (const check of checks) {
      await settleOwnedRoute(page, check.route);
      const locator = check.locator();
      await expect(locator).toBeVisible();
      await expectTouchTargetSize(locator, `${check.route} primary control`);
    }
  });

  test("dashboard admin root remains an authenticated 404 and is not advertised", async ({ page }) => {
    const response = await page.goto("/dashboard/admin", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(404);
    await page.goto("/dashboard");
    await page.setViewportSize({ width: 800, height: 1280 });
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.locator('a[href="/dashboard/admin"]')).toHaveCount(0);
    await expect(page.locator('a[href="/dashboard/admin/ai-readiness"]')).toHaveCount(1);
  });

  test("settings never reports success after a server failure", async ({ page }) => {
    await page.route("**/api/settings", async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "simulated settings failure" }) });
      } else {
        await route.continue();
      }
    });
    await settleOwnedRoute(page, "/dashboard/settings");
    await page.getByRole("button", { name: "Save presentation defaults" }).click();
    await expect(page.getByRole("alert")).toContainText("simulated settings failure");
    await expect(page.getByText(/saved and confirmed by the server/i)).toHaveCount(0);
  });

  test("user creation failure remains visible and does not claim success", async ({ page }) => {
    await page.route("**/api/users", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "simulated user failure" }) });
      } else {
        await route.continue();
      }
    });
    await settleOwnedRoute(page, "/dashboard/users");
    await page.getByRole("button", { name: "Invite user" }).click();
    await page.getByPlaceholder("Email address").fill("failure@example.invalid");
    await page.getByPlaceholder("Password (minimum 8 characters)").fill("not-a-real-secret");
    await page.getByRole("button", { name: "Create user" }).click();
    await expect(page.getByRole("alert")).toContainText("simulated user failure");
    await expect(page.getByText(/created and confirmed/i)).toHaveCount(0);
  });

  test("search uses one control and preserves its query in the URL", async ({ page }) => {
    await settleOwnedRoute(page, "/dashboard/search");
    await expect(page.getByRole("searchbox")).toHaveCount(1);
    await page.getByRole("searchbox").fill("hospital");
    await expect(page).toHaveURL(/\/dashboard\/search\?q=hospital/);
  });
});
