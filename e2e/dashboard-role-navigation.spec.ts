import { tabletPrimaryTest as test, expect } from "./auth-helper";
import type { Browser, BrowserContext, Page } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

type Role = "ADMIN" | "PROPOSAL_MANAGER" | "REVIEWER" | "VIEWER";

type CreatedUser = {
  id: string;
  email: string;
  role: Role;
};

const KNOWLEDGE_ROUTES = [
  "/dashboard/company",
  "/dashboard/company/readiness",
  "/dashboard/company/plan-b-import",
  "/dashboard/company/review-board",
  "/dashboard/company/review",
  "/dashboard/assets",
  "/dashboard/setup",
  "/dashboard/settings",
] as const;

const ADMIN_ROUTES = [
  "/dashboard/users",
  "/dashboard/admin/ai-readiness",
  "/dashboard/system",
] as const;

const OWNED_RESTRICTED_ROUTES = [
  "/dashboard/settings",
  "/dashboard/assets",
  "/dashboard/setup",
  "/dashboard/users",
] as const;

async function createLoggedInContext(browser: Browser, email: string, password: string): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const response = await context.request.post("/api/auth/login", { data: { email, password } });
  expect(response.status()).toBe(200);

  const sessionHeader = response.headersArray().find(
    (header) => header.name.toLowerCase() === "set-cookie" && header.value.startsWith("hope_session="),
  );
  expect(sessionHeader, "login must return a hope_session cookie").toBeTruthy();
  const value = sessionHeader!.value.split(";")[0].split("=").slice(1).join("=");
  expect(value).not.toBe("");

  await context.addCookies([
    {
      name: "hope_session",
      value,
      url: new URL(baseURL).origin,
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
  return context;
}

async function navigationHrefs(page: Page): Promise<string[]> {
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(navigation).toBeVisible();
  return navigation.locator('a[href^="/dashboard"]').evaluateAll((links) =>
    links
      .map((link) => link.getAttribute("href"))
      .filter((href): href is string => Boolean(href)),
  );
}

function expectedForbiddenOwnedRoutes(role: Role): string[] {
  if (role === "ADMIN") return [];
  if (role === "PROPOSAL_MANAGER") return ["/dashboard/users"];
  return [...OWNED_RESTRICTED_ROUTES];
}

function expectedAllowedOwnedRoutes(role: Role): string[] {
  return OWNED_RESTRICTED_ROUTES.filter((route) => !expectedForbiddenOwnedRoutes(role).includes(route));
}

test.describe("dashboard role navigation and direct-route authorization", () => {
  test("VIEWER, REVIEWER, PROPOSAL_MANAGER, and ADMIN receive one role-correct navigation authority", async ({ page, browser }) => {
    const email = `role-matrix-${Date.now()}-${test.info().workerIndex}@example.test`;
    const password = "RoleMatrix12345";
    let created: CreatedUser | null = null;
    let roleContext: BrowserContext | null = null;

    try {
      const createResponse = await page.request.post("/api/users", {
        data: { name: "Role Matrix User", email, password, role: "VIEWER" },
      });
      expect(createResponse.status(), "primary seeded account must be able to create a test user").toBe(201);
      created = (await createResponse.json()).user as CreatedUser;

      roleContext = await createLoggedInContext(browser, email, password);
      const rolePage = await roleContext.newPage();

      for (const role of ["VIEWER", "REVIEWER", "PROPOSAL_MANAGER", "ADMIN"] as const) {
        const updateResponse = await page.request.put(`/api/users/${created.id}`, { data: { role } });
        expect(updateResponse.status(), `role update to ${role}`).toBe(200);

        await rolePage.goto("/dashboard", { waitUntil: "domcontentloaded" });
        await expect(rolePage).toHaveURL(/\/dashboard$/);
        const hrefs = await navigationHrefs(rolePage);
        const navigation = rolePage.getByRole("navigation", { name: "Primary navigation" });
        await expect(navigation.locator('[aria-current="page"]'), `${role} dashboard active item`).toHaveCount(1);

        const seesKnowledge = role === "ADMIN" || role === "PROPOSAL_MANAGER";
        for (const route of KNOWLEDGE_ROUTES) {
          expect(hrefs.includes(route), `${role} knowledge route ${route}`).toBe(seesKnowledge);
        }
        for (const route of ADMIN_ROUTES) {
          expect(hrefs.includes(route), `${role} admin route ${route}`).toBe(role === "ADMIN");
        }
        expect(hrefs).not.toContain("/dashboard/admin");

        for (const route of expectedForbiddenOwnedRoutes(role)) {
          await rolePage.goto(route, { waitUntil: "domcontentloaded" });
          await expect(rolePage, `${role} must not resolve ${route}`).toHaveURL(/\/dashboard$/);
          await expect(rolePage.getByRole("navigation", { name: "Primary navigation" }).locator('[aria-current="page"]')).toHaveCount(1);
        }

        for (const route of expectedAllowedOwnedRoutes(role)) {
          const response = await rolePage.goto(route, { waitUntil: "domcontentloaded" });
          expect(response?.status(), `${role} allowed route ${route}`).toBeLessThan(400);
          await expect(rolePage, `${role} allowed route ${route}`).toHaveURL(new RegExp(`${route.replaceAll("/", "\\/")}$`));
          await expect(rolePage.getByRole("navigation", { name: "Primary navigation" }).locator('[aria-current="page"]')).toHaveCount(1);
        }

        const adminChild = await rolePage.goto("/dashboard/admin/ai-readiness", { waitUntil: "domcontentloaded" });
        if (role === "ADMIN") {
          expect(adminChild?.status()).toBeLessThan(400);
          await expect(rolePage).toHaveURL(/\/dashboard\/admin\/ai-readiness$/);
        } else {
          await expect(rolePage).toHaveURL(/\/dashboard$/);
        }

        const deadAdminRoot = await rolePage.goto("/dashboard/admin", { waitUntil: "domcontentloaded" });
        expect(deadAdminRoot?.status(), `${role} admin root remains unimplemented`).toBe(404);
      }
    } finally {
      await roleContext?.close();
      if (created) {
        const deleteResponse = await page.request.delete(`/api/users/${created.id}`);
        expect(deleteResponse.status(), "temporary role-matrix user cleanup").toBe(200);
      }
    }
  });
});
