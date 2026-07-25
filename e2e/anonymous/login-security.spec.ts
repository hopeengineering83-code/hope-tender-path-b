import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Credentials must never be retained in Playwright traces, videos, or failure
// screenshots. These worker-scoped settings apply to every test in this file;
// context-specific settings such as JavaScript enablement remain inside the
// relevant describe group.
test.use({ trace: "off", video: "off", screenshot: "off" });

function testCredentials(prefix: string) {
  const token = randomUUID().replace(/-/g, "");
  return {
    email: `${prefix}-${token.slice(0, 12)}@example.test`,
    password: `T-${token.slice(12)}!9a`,
  };
}

function assertSecretAbsent(value: string, secrets: string[]) {
  for (const secret of secrets) expect(value).not.toContain(secret);
}

function passwordField(page: Parameters<typeof test>[0] extends never ? never : any) {
  return page.getByLabel("Password", { exact: true });
}

test.describe("login security before hydration", () => {
  test.use({ javaScriptEnabled: false });

  test("native form submits by POST without credential-bearing URL or history", async ({ page }) => {
    const credentials = testCredentials("native");
    const observed: { method?: string; url?: string } = {};

    await page.route("**/api/auth/login", async (route) => {
      const request = route.request();
      observed.method = request.method();
      observed.url = request.url();
      await route.fulfill({
        status: 303,
        headers: {
          location: "/login?error=INVALID_CREDENTIALS",
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        },
      });
    });

    await page.goto("/login");
    const form = page.locator("form[data-auth-form='safe-post']");
    await expect(form).toHaveAttribute("method", "post");
    await expect(form).toHaveAttribute("action", "/api/auth/login");

    await page.getByLabel("Email", { exact: true }).fill(credentials.email);
    await passwordField(page).fill(credentials.password);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();

    await expect.poll(() => observed.method).toBe("POST");
    expect(observed.url).toBeTruthy();
    assertSecretAbsent(observed.url ?? "", [credentials.email, credentials.password]);
    await expect(page).toHaveURL(/\/login\?error=INVALID_CREDENTIALS$/);
    assertSecretAbsent(page.url(), [credentials.email, credentials.password]);
    assertSecretAbsent(await page.locator("body").innerText(), [credentials.email, credentials.password]);
  });
});

test.describe("hydrated login security", () => {
  test("normal login uses the real POST endpoint and replaces the login location", async ({ page }) => {
    const email = process.env.E2E_TEST_EMAIL;
    const password = process.env.E2E_TEST_PASSWORD;
    test.skip(!email || !password, "Isolated CI login fixture is not configured");

    const requestUrls: string[] = [];
    page.on("request", (request) => requestUrls.push(request.url()));

    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(email!);
    await passwordField(page).fill(password!);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard(?:\/|$)/);

    for (const url of requestUrls) assertSecretAbsent(url, [email!, password!]);
    assertSecretAbsent(page.url(), [email!, password!]);
  });

  test("failed login exposes only a fixed public message", async ({ page }) => {
    const credentials = testCredentials("failed");
    const consoleText: string[] = [];
    const requestUrls: string[] = [];
    page.on("console", (message) => consoleText.push(message.text()));
    page.on("request", (request) => requestUrls.push(request.url()));

    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(credentials.email);
    await passwordField(page).fill(credentials.password);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();

    await expect(page.getByRole("alert")).toContainText("The email or password is incorrect.");
    assertSecretAbsent(page.url(), [credentials.email, credentials.password]);
    assertSecretAbsent(await page.getByRole("alert").innerText(), [credentials.email, credentials.password]);
    assertSecretAbsent(consoleText.join("\n"), [credentials.email, credentials.password]);
    for (const url of requestUrls) assertSecretAbsent(url, [credentials.email, credentials.password]);
  });

  test("database wake-up retry reuses POST without moving credentials into the URL", async ({ page }) => {
    const credentials = testCredentials("retry");
    let attempts = 0;

    await page.route("**/api/auth/login", async (route) => {
      attempts += 1;
      await route.fulfill({
        status: attempts === 1 ? 503 : 401,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify(attempts === 1
          ? { error: "Authentication is temporarily unavailable. Please try again shortly.", code: "AUTH_SERVICE_UNAVAILABLE" }
          : { error: "The email or password is incorrect.", code: "INVALID_CREDENTIALS" }),
      });
    });

    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(credentials.email);
    await passwordField(page).fill(credentials.password);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("temporarily unavailable");
    await page.getByRole("button", { name: "Retry now", exact: true }).click();
    await expect.poll(() => attempts).toBe(2);
    await expect(page.getByRole("alert")).toContainText("incorrect");
    assertSecretAbsent(page.url(), [credentials.email, credentials.password]);
  });

  test("password visibility is explicit and reversible", async ({ page }) => {
    const credentials = testCredentials("visibility");
    await page.goto("/login");
    const password = passwordField(page);
    await password.fill(credentials.password);
    await expect(password).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password", exact: true }).click();
    await expect(password).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password", exact: true }).click();
    await expect(password).toHaveAttribute("type", "password");
  });
});
