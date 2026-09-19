import { tabletPrimaryTest as test, expect } from "./auth-helper";
import type { APIRequestContext, Browser, BrowserContext, Page, Request as PlaywrightRequest } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

// Team/company tenancy is intentionally not asserted here. The repository's
// current user/company model creates personal workspaces and global users;
// Issue #1151 owns the schema/auth/API architecture needed for company-scoped
// team membership and minimum-data read contracts.
const TENANCY_DEPENDENCY = "#1151";

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

// Post-consolidation (see lib/dashboard-navigation.ts), none of these routes
// is its own literal sidebar link anymore — each is a memberHref reached via
// its parent destination's own sub-nav tab bar. The parent destination is
// what actually appears/disappears from the rendered nav per role.
const OWNED_ROUTE_PARENT_HREF: Record<(typeof OWNED_RESTRICTED_ROUTES)[number]["path"], string> = {
  "/dashboard/settings": "/dashboard/company",
  "/dashboard/assets": "/dashboard/company",
  "/dashboard/setup": "/dashboard/company",
  "/dashboard/users": "/dashboard/activity",
};

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
    const email = `role-contract-${role.toLowerCase()}-${nonce}@example.test`;
    const response = await adminRequest.post("/api/users", {
      data: { name: `${role} route-contract user`, email, password, role },
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

async function assertDirectApiRolePolicy(identity: LoggedInIdentity): Promise<void> {
  const { context, role } = identity;
  const canManageKnowledge = role === "ADMIN" || role === "PROPOSAL_MANAGER";

  // These checks prove only role gates for the APIs used by the four owned
  // restricted pages. They do not claim company/team tenancy or minimum-data
  // isolation; those policies are external dependency #1151.
  const assetMutation = await context.request.post("/api/company/assets", { multipart: { assetType: "LOGO" } });
  expect(assetMutation.status(), `${role} asset mutation role policy`).toBe(canManageKnowledge ? 400 : 403);

  const companyMutation = await context.request.put("/api/company", { data: { setupCompletedAt: "not-a-valid-date" } });
  expect(companyMutation.status(), `${role} company mutation role policy`).toBe(canManageKnowledge ? 400 : 403);

  const settingsRead = await context.request.get("/api/settings");
  expect(settingsRead.status(), `${role} settings read role policy`).toBe(canManageKnowledge ? 200 : 403);

  const settingsMutation = await context.request.put("/api/settings", { data: { exportFormat: "ZIP" } });
  expect(settingsMutation.status(), `${role} settings mutation role policy`).toBe(canManageKnowledge ? 400 : 403);

  const usersRead = await context.request.get("/api/users");
  expect(usersRead.status(), `${role} users API role gate`).toBe(role === "ADMIN" ? 200 : 403);
}

test.describe("dashboard role navigation and direct-route authorization", () => {
  test("isolated role sessions enforce owned navigation, pre-render redirects, and API role gates", async ({ page, browser }) => {
    test.setTimeout(120_000);
    test.info().annotations.push({
      type: "external-dependency",
      description: `Company-scoped team membership and minimum-data API reads are tracked in Issue ${TENANCY_DEPENDENCY}.`,
    });

    const password = "RoleIsolation12345";
    const createdUsers: CreatedUser[] = [];
    const identities: LoggedInIdentity[] = [];

    try {
      await createRoleUsers(page.request, password, createdUsers);

      for (const user of createdUsers) {
        const loggedIn = await createLoggedInContext(browser, user.email, password);
        identities.push({ ...user, ...loggedIn, page: await loggedIn.context.newPage() });
      }

      expect(
        new Set(identities.map((identity) => identity.sessionValue)).size,
        "every role must use a distinct session cookie and browser context",
      ).toBe(ROLES.length);

      for (const identity of identities) {
        const { role, page: rolePage } = identity;
        await rolePage.goto("/dashboard", { waitUntil: "domcontentloaded" });
        await expect(rolePage).toHaveURL(/\/dashboard$/);

        const hrefs = await navigationHrefs(rolePage);
        const navigation = rolePage.getByRole("navigation", { name: "Primary navigation" });
        await expect(navigation.locator('[aria-current="page"]'), `${role} dashboard active item`).toHaveCount(1);

        for (const route of OWNED_RESTRICTED_ROUTES) {
          // The route itself is never a literal sidebar link (it's a
          // memberHref) — its parent destination is what's actually
          // advertised or hidden per role.
          expect(hrefs.includes(route.path), `${role} must never see ${route.path} itself as a literal sidebar link`).toBe(false);
          expect(
            hrefs.includes(OWNED_ROUTE_PARENT_HREF[route.path]),
            `${role} owned navigation parent ${OWNED_ROUTE_PARENT_HREF[route.path]} for ${route.path}`,
          ).toBe(roleCanAccess(role, route));
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

        // SCREENSHOT-R2 fixed the /dashboard/admin 404 (documented critical
        // screenshot gap): it's now a real ADMIN-gated page, but — unlike
        // OWNED_RESTRICTED_ROUTES — it stays deliberately absent from nav
        // for every role, including ADMIN (reached directly / via its
        // sub-pages, not as a top-level nav item), so it can't share that
        // array's "advertised iff allowed" contract.
        const adminRootResponse = await rolePage.goto("/dashboard/admin", { waitUntil: "domcontentloaded" });
        if (role === "ADMIN") {
          expect(adminRootResponse?.status(), `${role} admin root is implemented and accessible`).toBeLessThan(400);
          await expect(rolePage, `${role} admin root resolves at its own path`).toHaveURL(/\/dashboard\/admin$/);
          await expect(rolePage.getByRole("heading", { name: "Admin", level: 1 })).toBeVisible();
        } else {
          expect(adminRootResponse?.status(), `${role} admin root redirect`).toBeLessThan(400);
          await expect(rolePage, `${role} admin root remains unadvertised and redirects away`).toHaveURL(/\/dashboard$/);
        }

        await assertDirectApiRolePolicy(identity);
      }
    } finally {
      for (const identity of identities) await identity.context.close();
      for (const user of createdUsers) {
        const deleteResponse = await page.request.delete(`/api/users/${user.id}`);
        expect(deleteResponse.status(), `temporary ${user.role} user cleanup`).toBe(200);
      }
    }
  });
});
