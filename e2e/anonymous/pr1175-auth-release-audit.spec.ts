import { test, expect } from "@playwright/test";

const PROTECTED_ROUTES = [
  "/dashboard",
  "/dashboard/tenders",
  "/dashboard/company",
  "/dashboard/documents",
  "/dashboard/export",
  "/dashboard/admin",
  "/dashboard/admin/ai-readiness",
  "/dashboard/admin/safety-center",
  "/dashboard/users",
  "/dashboard/system",
];

test.describe("PR #1175 anonymous authentication and route-boundary audit", () => {
  test("invalid login fails safely without creating a session or leaking runtime details", async ({ request }) => {
    const response = await request.post("/api/auth/login", {
      data: { email: "not-a-user@example.test", password: "DefinitelyWrongPassword123!" },
    });
    expect([400, 401, 403, 429]).toContain(response.status());
    const body = await response.text();
    expect(body).not.toMatch(/PrismaClient|prisma\.|stack trace|node_modules|postgresql:\/\/|DATABASE_URL|SELECT\s+.+FROM|\/home\//i);
    const sessionCookie = response.headersArray().find(
      ({ name, value }) => name.toLowerCase() === "set-cookie" && value.startsWith("hope_session="),
    );
    expect(sessionCookie, "failed authentication must not create hope_session").toBeUndefined();
  });

  test("login and recovery pages render cleanly and password visibility is connected", async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });
    page.on("pageerror", (error) => runtimeErrors.push(error.message));

    for (const route of ["/login", "/forgot-password", "/reset-password"]) {
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      expect(response?.status(), route).toBeLessThan(400);
      await page.waitForTimeout(100);
    }

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    const password = page.locator('input[type="password"]');
    await expect(password).toBeVisible();
    const toggle = page.getByRole("button", { name: /show password/i });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.locator('input[type="text"][name="password"], input[type="text"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /hide password/i })).toBeVisible();
    expect(runtimeErrors).toEqual([]);
  });

  test("all representative protected routes redirect to login without rendering private UI", async ({ page }) => {
    for (const route of PROTECTED_ROUTES) {
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      expect(response?.status(), `${route}: redirect response`).toBeLessThan(400);
      await expect(page, route).toHaveURL(/\/login/);
      await expect(page.getByText(/Primary Owner Fixture|User Management|AI environment readiness|System Status/i)).toHaveCount(0);
    }
  });
});
