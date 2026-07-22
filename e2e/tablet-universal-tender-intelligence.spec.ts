import { tabletPrimaryTest as test, expect } from "./auth-helper";
import type { Locator, Page, Route } from "@playwright/test";

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function expectAppAlert(page: Page, text: string) {
  // Next.js renders its own empty role="alert" route announcer
  // (#__next-route-announcer__) on every page, so a bare getByRole("alert")
  // is ambiguous in Playwright's strict mode once the app also renders a
  // real alert. Filtering by the expected text disambiguates to the app's
  // own alert without matching the (always-empty) announcer.
  await expect(page.getByRole("alert").filter({ hasText: text })).toBeVisible();
}

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

async function expectMainDoesNotHideOverflow(page: Page) {
  const overflowX = await page.locator("#main-content").evaluate((element) => getComputedStyle(element).overflowX);
  expect(overflowX, "The dashboard shell must not hide or clip horizontal overflow").not.toMatch(/hidden|clip/);
}

async function expectTouchTargetSize(locator: Locator, label = "touch target") {
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

const SETTINGS = {
  defaultCurrency: "USD",
  aiStrictMode: true,
  allowBrandingDefault: true,
  allowSignatureDefault: true,
  allowStampDefault: true,
  exportFormat: "DOCX",
  pageNumbering: true,
  includeTableOfContents: false,
  language: "en",
};

const COMPANY = {
  name: "Responsive Contract Test Company",
  legalName: "Responsive Contract Test Company PLC",
  email: "company@example.test",
  phone: "",
  website: "",
  address: "",
  description: "",
  profileSummary: "",
  serviceLines: [],
  sectors: [],
  knowledgeMode: "PROFILE_FIRST",
  setupCompletedAt: null as string | null,
  experts: [] as Array<{ fullName: string }>,
  projects: [] as Array<{ name: string }>,
};

const ACTIVE_LOGO = {
  id: "asset-logo-1",
  assetType: "LOGO",
  originalFileName: "existing-logo.png",
  mimeType: "image/png",
  size: 12,
  isActive: true,
  createdAt: new Date(0).toISOString(),
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
    await expectMainDoesNotHideOverflow(page);
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
        await expectMainDoesNotHideOverflow(page);
        await expectNoHorizontalScroll(page);

        // /dashboard/search is intentionally not part of the primary sidebar
        // destinations post-consolidation — Global Search moved to the
        // sticky header (see app/dashboard/layout.tsx), so no sidebar item
        // resolves as active for it. Every other owned route here still
        // resolves to exactly one active parent destination via
        // lib/dashboard-navigation.ts's memberHrefs mechanism (e.g.
        // /dashboard/settings activates "Company Vault").
        const expectedActiveCount = route === "/dashboard/search" ? 0 : 1;

        if (viewport.width < 1280) {
          const opener = page.getByRole("button", { name: "Open navigation" });
          await expect(opener).toBeVisible();
          await opener.click();
          const drawer = page.getByRole("dialog", { name: "Hope Tender" });
          await expect(drawer).toBeVisible();
          await expect(drawer.locator('[aria-current="page"]')).toHaveCount(expectedActiveCount);
          await page.getByRole("button", { name: "Close navigation" }).last().click();
          await expect(drawer).toBeHidden();
        } else {
          const navigation = page.getByRole("navigation", { name: "Primary navigation" });
          await expect(navigation).toBeVisible();
          await expect(navigation.locator('[aria-current="page"]')).toHaveCount(expectedActiveCount);
        }
      }
    });
  }

  test("owned primary controls remain visible and touch-sized", async ({ page }) => {
    const checks: Array<{ route: string; locator: () => Locator }> = [
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

  test("every rendered navigation route resolves and exactly one route is active", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await settleOwnedRoute(page, "/dashboard");
    const navigation = page.getByRole("navigation", { name: "Primary navigation" });
    const hrefs = await navigation.locator('a[href^="/dashboard"]').evaluateAll((links) =>
      links.map((link) => link.getAttribute("href")).filter((href): href is string => Boolean(href)),
    );
    const advertised = [...new Set(hrefs)];

    // Post-consolidation the primary sidebar advertises only 5 top-level
    // destinations (Tenders [includes Overview], Company Vault, Engine,
    // Documents & Export, Administration) — formerly-separate routes like
    // /dashboard/admin/ai-readiness are now memberHrefs of Administration,
    // reached via its own sub-nav tab bar, not a literal sidebar link.
    expect(advertised).not.toContain("/dashboard/admin");
    expect(advertised).not.toContain("/dashboard/admin/ai-readiness");
    expect(advertised.length).toBe(5);

    for (const href of advertised) {
      const response = await page.goto(href, { waitUntil: "domcontentloaded" });
      await expect(page, href).not.toHaveURL(/\/login/);
      expect(response?.status(), `${href} must not be a dead route`).toBeLessThan(400);
      await expect(page.getByRole("navigation", { name: "Primary navigation" }).locator('[aria-current="page"]'), href).toHaveCount(1);
    }

    // Formerly-standalone routes now consolidated as memberHrefs must still
    // resolve directly and activate exactly one (their parent) sidebar item.
    const consolidatedMemberRoutes: Array<[string, string]> = [
      ["/dashboard/admin/ai-readiness", "/dashboard/activity"],
      ["/dashboard/history", "/dashboard/tenders"],
      ["/dashboard/company/readiness", "/dashboard/company"],
    ];
    for (const [memberHref, expectedParent] of consolidatedMemberRoutes) {
      const response = await page.goto(memberHref, { waitUntil: "domcontentloaded" });
      await expect(page, memberHref).not.toHaveURL(/\/login/);
      expect(response?.status(), `${memberHref} must not be a dead route`).toBeLessThan(400);
      const active = page.getByRole("navigation", { name: "Primary navigation" }).locator('[aria-current="page"]');
      await expect(active, memberHref).toHaveCount(1);
      await expect(active, `${memberHref} must activate its consolidated parent ${expectedParent}`).toHaveAttribute("href", expectedParent);
    }

    // /dashboard/admin is intentionally unadvertised but, since SCREENSHOT-R2,
    // implemented and ADMIN-gated rather than a dead 404 (see the dedicated
    // test below for the full contract).
    const adminRoot = await page.goto("/dashboard/admin", { waitUntil: "domcontentloaded" });
    expect(adminRoot?.status()).toBeLessThan(400);
  });

  test("dashboard admin root is implemented (ADMIN-gated) but never advertised in nav", async ({ page }) => {
    // SCREENSHOT-R2 fixed the /dashboard/admin 404 (documented critical
    // screenshot gap): this fixture's seeded primary account is ADMIN, so
    // the route now resolves (guarded by the shared requireDashboardRole
    // layout, same as settings/assets/setup/users) instead of 404ing. It
    // still stays deliberately out of the nav — reached directly or via
    // its sub-pages, not as a top-level nav item.
    const response = await page.goto("/dashboard/admin", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { name: "Admin", level: 1 })).toBeVisible();
    await page.goto("/dashboard");
    await page.setViewportSize({ width: 800, height: 1280 });
    await page.getByRole("button", { name: "Open navigation" }).click();
    // The desktop "Primary navigation" landmark stays in the DOM (hidden via
    // CSS, not removed) alongside the opened "Mobile primary navigation"
    // drawer — two distinct accessible landmarks, by design. Scope to the
    // one actually open to avoid double-counting the same link rendered in
    // both.
    const mobileNav = page.getByRole("navigation", { name: "Mobile primary navigation" });
    await expect(mobileNav.locator('a[href="/dashboard/admin"]')).toHaveCount(0);
    // /dashboard/admin/ai-readiness is consolidated as a memberHref of the
    // Administration destination (lib/dashboard-navigation.ts) — it is no
    // longer its own literal sidebar link either, so it must not appear
    // directly, but its parent Administration destination must.
    await expect(mobileNav.locator('a[href="/dashboard/admin/ai-readiness"]')).toHaveCount(0);
    await expect(mobileNav.locator('a[href="/dashboard/activity"]')).toHaveCount(1);
  });

  test("settings failure is visible and never claims success", async ({ page }) => {
    await page.route("**/api/settings", async (route) => {
      if (route.request().method() === "PUT") {
        await fulfillJson(route, 500, { error: "simulated settings failure" });
      } else {
        await fulfillJson(route, 200, { settings: SETTINGS, presentationSemantics: { description: "Presentation only." } });
      }
    });
    await settleOwnedRoute(page, "/dashboard/settings");
    await page.getByRole("button", { name: "Save presentation defaults" }).click();
    await expectAppAlert(page, "simulated settings failure");
    await expect(page.getByText(/saved and confirmed by the server/i)).toHaveCount(0);
  });

  test("settings success is reported only after authoritative refresh", async ({ page }) => {
    let getCount = 0;
    await page.route("**/api/settings", async (route) => {
      if (route.request().method() === "GET") {
        getCount += 1;
        await fulfillJson(route, 200, { settings: SETTINGS, presentationSemantics: { description: "Presentation only." } });
      } else {
        await fulfillJson(route, 200, { settings: SETTINGS });
      }
    });
    await settleOwnedRoute(page, "/dashboard/settings");
    await page.getByRole("button", { name: "Save presentation defaults" }).click();
    await expect(page.getByRole("status")).toContainText("saved and confirmed by the server");
    expect(getCount).toBeGreaterThanOrEqual(2);
  });

  test("asset upload and removal failures remain visible", async ({ page }) => {
    await page.route("**/api/company/assets*", async (route) => {
      const method = route.request().method();
      if (method === "GET") await fulfillJson(route, 200, { assets: [ACTIVE_LOGO] });
      else await fulfillJson(route, 500, { error: method === "POST" ? "simulated asset upload failure" : "simulated asset removal failure" });
    });
    await settleOwnedRoute(page, "/dashboard/assets");
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "letterhead.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from("test"),
    });
    await expectAppAlert(page, "simulated asset upload failure");
    await expect(page.getByText(/uploaded and confirmed by the server/i)).toHaveCount(0);

    await page.getByRole("button", { name: "Remove" }).click();
    await expectAppAlert(page, "simulated asset removal failure");
    await expect(page.getByText(/removed and the asset list was refreshed/i)).toHaveCount(0);
  });

  test("asset success requires a refreshed server list", async ({ page }) => {
    let assets: typeof ACTIVE_LOGO[] = [];
    let getCount = 0;
    await page.route("**/api/company/assets*", async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        getCount += 1;
        await fulfillJson(route, 200, { assets });
      } else if (method === "POST") {
        assets = [{ ...ACTIVE_LOGO, assetType: "LETTERHEAD", originalFileName: "letterhead.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }];
        await fulfillJson(route, 201, { asset: assets[0] });
      } else {
        assets = [];
        await fulfillJson(route, 200, { ok: true });
      }
    });
    await settleOwnedRoute(page, "/dashboard/assets");
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "letterhead.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from("test"),
    });
    await expect(page.getByRole("status")).toContainText("uploaded and confirmed by the server");
    // exact: true — the success status message above also contains
    // "letterhead.docx" as a substring, ambiguous against the actual
    // filename list item without an exact match.
    await expect(page.getByText("letterhead.docx", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("status")).toContainText("removed and the asset list was refreshed");
    await expect(page.getByText("letterhead.docx", { exact: true })).toHaveCount(0);
    expect(getCount).toBeGreaterThanOrEqual(3);
  });

  test("setup mutations show every server failure without advancing or claiming success", async ({ page }) => {
    let companyFailure = "simulated profile failure";
    await page.route("**/api/company", async (route) => {
      if (route.request().method() === "GET") await fulfillJson(route, 200, COMPANY);
      else await fulfillJson(route, 500, { error: companyFailure });
    });
    await page.route("**/api/upload", (route) => fulfillJson(route, 500, { error: "simulated document failure" }));
    await page.route("**/api/company/experts", (route) => fulfillJson(route, 500, { error: "simulated expert failure" }));
    await page.route("**/api/company/projects", (route) => fulfillJson(route, 500, { error: "simulated project failure" }));

    await settleOwnedRoute(page, "/dashboard/setup");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expectAppAlert(page, "simulated profile failure");
    await expect(page.getByRole("heading", { name: "Company information" })).toBeVisible();

    await page.getByRole("button", { name: /Documents/ }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: "profile.pdf", mimeType: "application/pdf", buffer: Buffer.from("test") });
    await expectAppAlert(page, "1 document failed");
    await expect(page.getByText("simulated document failure")).toBeVisible();

    await page.getByRole("button", { name: /Experts/ }).click();
    await page.getByLabel("Expert full name").fill("Failure Expert");
    await page.getByRole("button", { name: "Add expert" }).click();
    await expectAppAlert(page, "simulated expert failure");

    await page.getByRole("button", { name: /Projects/ }).click();
    await page.getByLabel("Project name").fill("Failure Project");
    await page.getByRole("button", { name: "Add project" }).click();
    await expectAppAlert(page, "simulated project failure");

    companyFailure = "simulated completion failure";
    await page.getByRole("button", { name: /Complete/ }).click();
    await page.getByRole("button", { name: "Complete and open dashboard" }).click();
    await expectAppAlert(page, "simulated completion failure");
    await expect(page).toHaveURL(/\/dashboard\/setup/);
  });

  test("setup success walks the server-confirmed path and refreshes company truth", async ({ page }) => {
    const company = structuredClone(COMPANY);
    let getCount = 0;
    await page.route("**/api/company", async (route) => {
      if (route.request().method() === "GET") {
        getCount += 1;
        await fulfillJson(route, 200, company);
        return;
      }
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      // The real /api/company route stores serviceLines/sectors as arrays
      // (toJsonArray on write, safeParseArr on read) even though the client
      // sends/edits them as comma-separated strings — mirror that here so
      // a second load doesn't try to .join() an already-joined string.
      const toArray = (value: unknown): string[] =>
        Array.isArray(value) ? value.map(String) : typeof value === "string" ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];
      Object.assign(company, body, { serviceLines: toArray(body.serviceLines), sectors: toArray(body.sectors) });
      await fulfillJson(route, 200, company);
    });
    await page.route("**/api/upload", (route) => fulfillJson(route, 201, { ok: true }));
    await page.route("**/api/company/experts", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as { fullName: string };
      company.experts.push({ fullName: body.fullName });
      await fulfillJson(route, 201, body);
    });
    await page.route("**/api/company/projects", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as { name: string };
      company.projects.push({ name: body.name });
      await fulfillJson(route, 201, body);
    });

    await settleOwnedRoute(page, "/dashboard/setup");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.getByRole("heading", { name: "Upload company documents" })).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles({ name: "profile.pdf", mimeType: "application/pdf", buffer: Buffer.from("test") });
    await expect(page.getByRole("status")).toContainText("1 document accepted by the server");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabel("Expert full name").fill("Confirmed Expert");
    await page.getByRole("button", { name: "Add expert" }).click();
    await expect(page.getByRole("status")).toContainText("Expert added and confirmed");
    await expect(page.getByText("Existing experts: 1")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabel("Project name").fill("Confirmed Project");
    await page.getByRole("button", { name: "Add project" }).click();
    await expect(page.getByRole("status")).toContainText("Project added and confirmed");
    await expect(page.getByText("Existing projects: 1")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByRole("button", { name: "Complete and open dashboard" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    expect(getCount).toBeGreaterThanOrEqual(5);
  });

  test("user creation failure remains visible and does not claim success", async ({ page }) => {
    await page.route("**/api/users", async (route) => {
      if (route.request().method() === "POST") await fulfillJson(route, 500, { error: "simulated user failure" });
      else await fulfillJson(route, 200, { users: [] });
    });
    await settleOwnedRoute(page, "/dashboard/users");
    await page.getByRole("button", { name: "Invite user" }).click();
    await page.getByPlaceholder("Email address").fill("failure@example.invalid");
    await page.getByPlaceholder("Password (minimum 8 characters)").fill("not-a-real-secret");
    await page.getByRole("button", { name: "Create user" }).click();
    await expectAppAlert(page, "simulated user failure");
    await expect(page.getByText(/created and confirmed/i)).toHaveCount(0);
  });

  test("user update and delete failures remain visible", async ({ page }) => {
    const user = { id: "user-1", name: "First User", email: "first@example.test", role: "REVIEWER", createdAt: new Date(0).toISOString() };
    await page.route("**/api/users", (route) => fulfillJson(route, 200, { users: [user] }));
    await page.route("**/api/users/**", async (route) => {
      await fulfillJson(route, 500, { error: route.request().method() === "PUT" ? "simulated update failure" : "simulated delete failure" });
    });
    await settleOwnedRoute(page, "/dashboard/users");
    // Edit mode replaces the row's display-name/email cell with a bare
    // "Display name" input (the email text disappears entirely), so a
    // hasText: user.email row filter stops matching anything the moment
    // editing starts. This fixture only ever seeds one user, so locate the
    // single data row positionally instead of by transient text content.
    const row = page.locator("tbody tr").first();
    await row.getByRole("button", { name: "Edit" }).click();
    await row.getByRole("button", { name: "Save" }).click();
    await expectAppAlert(page, "simulated update failure");
    await expect(page.getByText(/updated and confirmed/i)).toHaveCount(0);
    await row.getByRole("button", { name: "Cancel" }).click();

    page.once("dialog", (dialog) => dialog.accept());
    await row.getByRole("button", { name: "Delete" }).click();
    await expectAppAlert(page, "simulated delete failure");
    await expect(page.getByText(/deleted and the user list was refreshed/i)).toHaveCount(0);
  });

  test("user create update and delete success each reloads the user list", async ({ page }) => {
    let users = [{ id: "user-1", name: "First User", email: "first@example.test", role: "REVIEWER", createdAt: new Date(0).toISOString() }];
    let getCount = 0;
    await page.route("**/api/users", async (route) => {
      if (route.request().method() === "GET") {
        getCount += 1;
        await fulfillJson(route, 200, { users });
      } else {
        const body = JSON.parse(route.request().postData() ?? "{}") as { name: string; email: string; role: string };
        users = [...users, { id: "user-2", name: body.name, email: body.email, role: body.role, createdAt: new Date(0).toISOString() }];
        await fulfillJson(route, 201, { user: users.at(-1) });
      }
    });
    await page.route("**/api/users/**", async (route) => {
      const id = new URL(route.request().url()).pathname.split("/").at(-1);
      if (route.request().method() === "PUT") {
        const body = JSON.parse(route.request().postData() ?? "{}") as { name: string; role: string };
        users = users.map((user) => user.id === id ? { ...user, ...body } : user);
        await fulfillJson(route, 200, { user: users.find((user) => user.id === id) });
      } else {
        users = users.filter((user) => user.id !== id);
        await fulfillJson(route, 200, { ok: true });
      }
    });

    await settleOwnedRoute(page, "/dashboard/users");
    await page.getByRole("button", { name: "Invite user" }).click();
    await page.getByPlaceholder("Full name (optional)").fill("New User");
    await page.getByPlaceholder("Email address").fill("new@example.test");
    await page.getByPlaceholder("Password (minimum 8 characters)").fill("not-a-real-secret");
    await page.getByRole("button", { name: "Create user" }).click();
    await expect(page.getByRole("status")).toContainText("created and confirmed");

    // Edit mode replaces the row's display-name/email cell with a bare
    // "Display name" input (the email text disappears entirely), so a
    // hasText: "new@example.test" row filter stops matching anything the
    // moment editing starts. The new user is always appended last by the
    // mock, so locate it positionally while editing instead.
    let row = page.locator("tbody tr").last();
    await row.getByRole("button", { name: "Edit" }).click();
    await row.getByPlaceholder("Display name").fill("Updated User");
    await row.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toContainText("updated and confirmed");
    row = page.getByRole("row").filter({ hasText: "new@example.test" });
    await expect(row).toContainText("Updated User");

    page.once("dialog", (dialog) => dialog.accept());
    row = page.getByRole("row").filter({ hasText: "new@example.test" });
    await row.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("status")).toContainText("deleted and the user list was refreshed");
    // The success status banner itself reads "${email} deleted and the
    // user list was refreshed", so a page-wide getByText("new@example.test")
    // still finds one match there even after the row is really gone — scope
    // the absence check to the table's rows, not the whole page.
    await expect(page.getByRole("row").filter({ hasText: "new@example.test" })).toHaveCount(0);
    expect(getCount).toBeGreaterThanOrEqual(4);
  });

  test("search uses one control and preserves its query in the URL", async ({ page }) => {
    await settleOwnedRoute(page, "/dashboard/search");
    await expect(page.getByRole("searchbox")).toHaveCount(1);
    await page.getByRole("searchbox").fill("hospital");
    await expect(page).toHaveURL(/\/dashboard\/search\?q=hospital/);
  });

  test("search server failure is accessible and clears stale results", async ({ page }) => {
    await page.route("**/api/search?**", (route) => fulfillJson(route, 500, { error: "simulated search failure" }));
    await settleOwnedRoute(page, "/dashboard/search");
    await page.getByRole("searchbox").fill("hospital");
    await expectAppAlert(page, "simulated search failure");
    await expect(page.getByRole("heading", { name: /Tenders \(|Experts \(|Projects \(/ })).toHaveCount(0);
  });
});
