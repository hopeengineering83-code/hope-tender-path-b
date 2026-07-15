import { tabletPrimaryTest as test, expect } from "./auth-helper";
import type { APIRequestContext, Browser, BrowserContext, Page, Request as PlaywrightRequest } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

type Role = "ADMIN" | "PROPOSAL_MANAGER" | "REVIEWER" | "VIEWER";

type CreatedUser = {
  id: string;
  email: string;
  role: Role;
};

type LoggedInIdentity = CreatedUser & {
  context: BrowserContext;
  page: Page;
  sessionValue: string;
};

type OwnedRoute = {
  path: string;
  heading: string;
  dataPath: string;
  allowedRoles: readonly Role[];
};

const ROLES: readonly Role[] = ["VIEWER", "REVIEWER", "PROPOSAL_MANAGER", "ADMIN"];

const OWNED_RESTRICTED_ROUTES: readonly OwnedRoute[] = [
  { path: "/dashboard/settings", heading: "Settings", dataPath: "/api/settings", allowedRoles: ["ADMIN", "PROPOSAL_MANAGER"] },
  { path: "/dashboard/assets", heading: "Brand Assets", dataPath: "/api/company/assets", allowedRoles: ["ADMIN", "PROPOSAL_MANAGER"] },
  { path: "/dashboard/setup", heading: "Company Setup Wizard", dataPath: "/api/company", allowedRoles: ["ADMIN", "PROPOSAL_MANAGER"] },
  { path: "/dashboard/users", heading: "User Management", dataPath: "/api/users", allowedRoles: ["ADMIN"] },
] as const;

function roleCanAccess(role: Role, route: OwnedRoute): boolean {
  return route.allowedRoles.includes(role);
}

async function createLoggedInContext(
  browser: Browser,
  email: string,
  password: string,
): Promise<{ context: BrowserContext; sessionValue: string }> {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const response = await context.request.post("/api/auth/login", { data: { email, password } });
  expect(response.status()).toBe(200);

  const sessionHeader = response.headersArray().find(
    (header) => header.name.toLowerCase() === "set-cookie" && header.value.startsWith("hope_session="),
  );
  expect(sessionHeader, "login must return a hope_session cookie").toBeTruthy();
  const sessionValue = sessionHeader!.value.split(";")[0].split("=").slice(1).join("=");
  expect(sessionValue).not.toBe("");

  await context.addCookies([{
    name: "hope_session",
    value: sessionValue,
    url: new URL(baseURL).origin,
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
  }]);
  return { context, sessionValue };
}

async function navigationHrefs(page: Page): Promise<string[]> {
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(navigation).toBeVisible();
  return navigation.locator('a[href^="/dashboard"]').evaluateAll((links) =>
    links.map((link) => link.getAttribute("href")).filter((href): href is string => Boolean(href)),
  );
}

async function createRoleUsers(
  adminRequest: APIRequestContext,
  password: string,
  users: CreatedUser[],
): Promise<void> {
  const nonce = `${Date.now()}-${test.info().workerIndex}`;
  for (const role of ROLES) {
    const email = `role-isolation-${role.toLowerCase()}-${nonce}@example.test`;
    const response = await adminRequest.post("/api/users", {
      data: { name: `${role} isolated user`, email, password, role },
    });
    expect(response.status(), `primary seeded account must create the ${role} user`).toBe(201);
    users.push((await response.json()).user as CreatedUser);
  }
}

async function assertForbiddenRouteDoesNotRenderOrFetch(
  rolePage: Page,
  role: Role,
  route: OwnedRoute,
) {
  const dataRequests: string[] = [];
  const requestListener = (request: PlaywrightRequest) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === route.dataPath) dataRequests.push(`${request.method()} ${pathname}`);
  };

  rolePage.on("request", requestListener);
  try {
    await rolePage.goto(route.path, { waitUntil: "domcontentloaded" });
    await expect(rolePage, `${role} must not resolve ${route.path}`).toHaveURL(/\/dashboard$/);
    await rolePage.waitForTimeout(100);
  } finally {
    rolePage.off("request", requestListener);
  }

  await expect(
    rolePage.getByRole("heading", { name: route.heading, level: 1 }),
    `${role} must never render the restricted ${route.heading} page`,
  ).toHaveCount(0);
  expect(dataRequests, `${role} redirect must happen before ${route.dataPath} is fetched`).toEqual([]);
  await expect(
    rolePage.getByRole("navigation", { name: "Primary navigation" }).locator('[aria-current="page"]'),
  ).toHaveCount(1);
}

async function assertDirectApiPolicy(identity: LoggedInIdentity, primaryCompanyId: string): Promise<string> {
  const { context, role } = identity;
  const canManageKnowledge = role === "ADMIN" || role === "PROPOSAL_MANAGER";

  const companyRead = await context.request.get("/api/company");
  expect(companyRead.status(), `${role} can read only its own company workspace`).toBe(200);
  const company = await companyRead.json() as { id?: string; experts?: unknown[]; projects?: unknown[] };
  expect(company.id, `${role} company id`).toBeTruthy();
  expect(company.id, `${role} must not receive the seeded administrator company`).not.toBe(primaryCompanyId);
  expect(company.experts ?? [], `${role} must not inherit another tenant's experts`).toEqual([]);
  expect(company.projects ?? [], `${role} must not inherit another tenant's projects`).toEqual([]);

  const assetRead = await context.request.get("/api/company/assets");
  expect(assetRead.status(), `${role} asset read remains authenticated and tenant-scoped`).toBe(200);
  const assetPayload = await assetRead.json() as { assets?: unknown[] };
  expect(assetPayload.assets ?? [], `${role} must not inherit another tenant's assets`).toEqual([]);

  const assetMutation = await context.request.post("/api/company/assets", { multipart: { assetType: "LOGO" } });
  expect(assetMutation.status(), `${role} asset mutation role policy`).toBe(canManageKnowledge ? 400 : 403);

  const companyMutation = await context.request.put("/api/company", { data: { setupCompletedAt: "not-a-valid-date" } });
  expect(companyMutation.status(), `${role} company mutation role policy`).toBe(canManageKnowledge ? 400 : 403);

  const settingsRead = await context.request.get("/api/settings");
  expect(settingsRead.status(), `${role} settings read role policy`).toBe(canManageKnowledge ? 200 : 403);

  const settingsMutation = await context.request.put("/api/settings", { data: { exportFormat: "ZIP" } });
  expect(settingsMutation.status(), `${role} settings mutation role policy`).toBe(canManageKnowledge ? 400 : 403);

  const usersRead = await context.request.get("/api/users");
  expect(usersRead.status(), `${role} users API role policy`).toBe(role === "ADMIN" ? 200 : 403);

  return company.id!;
}

test.describe("dashboard role navigation and direct-route authorization", () => {
  test("isolated role sessions enforce owned navigation, pre-render redirects, API roles, and tenant boundaries", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const password = "RoleIsolation12345";
    const createdUsers: CreatedUser[] = [];
    const identities: LoggedInIdentity[] = [];

    try {
      const primaryCompanyResponse = await page.request.get("/api/company");
      expect(primaryCompanyResponse.status(), "seeded administrator company must be readable").toBe(200);
      const primaryCompany = await primaryCompanyResponse.json() as { id?: string };
      expect(primaryCompany.id).toBeTruthy();

      await createRoleUsers(page.request, password, createdUsers);

      for (const user of createdUsers) {
        const loggedIn = await createLoggedInContext(browser, user.email, password);
        identities.push({ ...user, ...loggedIn, page: await loggedIn.context.newPage() });
      }

      expect(
        new Set(identities.map((identity) => identity.sessionValue)).size,
        "every role must use a distinct session cookie and browser context",
      ).toBe(ROLES.length);

      const companyIds: string[] = [];
      for (const identity of identities) {
        const { role, page: rolePage } = identity;
        await rolePage.goto("/dashboard", { waitUntil: "domcontentloaded" });
        await expect(rolePage).toHaveURL(/\/dashboard$/);

        const hrefs = await navigationHrefs(rolePage);
        const navigation = rolePage.getByRole("navigation", { name: "Primary navigation" });
        await expect(navigation.locator('[aria-current="page"]'), `${role} dashboard active item`).toHaveCount(1);

        for (const route of OWNED_RESTRICTED_ROUTES) {
          expect(hrefs.includes(route.path), `${role} owned navigation route ${route.path}`).toBe(roleCanAccess(role, route));
        }
        expect(hrefs).not.toContain("/dashboard/admin");

        for (const route of OWNED_RESTRICTED_ROUTES) {
          if (!roleCanAccess(role, route)) {
            await assertForbiddenRouteDoesNotRenderOrFetch(rolePage, role, route);
            continue;
          }

          const response = await rolePage.goto(route.path, { waitUntil: "domcontentloaded" });
          expect(response?.status(), `${role} allowed route ${route.path}`).toBeLessThan(400);
          await expect(rolePage, `${role} allowed route ${route.path}`).toHaveURL(
            new RegExp(`${route.path.replaceAll("/", "\\/")}$`),
          );
          await expect(rolePage.getByRole("heading", { name: route.heading, level: 1 })).toBeVisible();
          await expect(
            rolePage.getByRole("navigation", { name: "Primary navigation" }).locator('[aria-current="page"]'),
          ).toHaveCount(1);
        }

        const deadAdminRoot = await rolePage.goto("/dashboard/admin", { waitUntil: "domcontentloaded" });
        expect(deadAdminRoot?.status(), `${role} admin root remains unimplemented and unadvertised`).toBe(404);

        companyIds.push(await assertDirectApiPolicy(identity, primaryCompany.id!));
      }

      expect(new Set(companyIds).size, "each isolated role user must receive a distinct company tenant").toBe(ROLES.length);
    } finally {
      for (const identity of identities) await identity.context.close();
      for (const user of createdUsers) {
        const deleteResponse = await page.request.delete(`/api/users/${user.id}`);
        expect(deleteResponse.status(), `temporary ${user.role} user cleanup`).toBe(200);
      }
    }
  });
});
