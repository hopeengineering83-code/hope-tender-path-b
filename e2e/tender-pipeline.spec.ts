import { test, expect, type APIResponse, type Page } from "@playwright/test";

const FULL = process.env.E2E_FULL_AUTH === "true";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

async function preserveLoopbackSession(page: Page, response: APIResponse) {
  const origin = new URL(baseURL);
  if (origin.protocol !== "http:") return;

  const sessionHeader = response.headersArray().find(
    ({ name, value }) => name.toLowerCase() === "set-cookie" && value.startsWith("hope_session="),
  );
  expect(sessionHeader, "login response must set the session cookie").toBeTruthy();
  expect(sessionHeader?.value, "production-like login must retain the Secure cookie attribute").toMatch(/;\s*Secure(?:;|$)/i);

  const cookiePair = sessionHeader!.value.split(";", 1)[0];
  const separator = cookiePair.indexOf("=");
  expect(separator).toBeGreaterThan(0);
  const value = cookiePair.slice(separator + 1);
  expect(value).not.toBe("");

  // `next start` correctly emits a Secure production cookie, but CI serves the
  // isolated app over loopback HTTP. Clone only that cookie into the browser
  // context for the test; production cookie policy remains unchanged.
  await page.context().addCookies([{
    name: "hope_session",
    value,
    url: origin.origin,
    httpOnly: true,
    sameSite: "Lax",
    secure: false,
  }]);
}

async function login(page: Page) {
  const email = process.env.E2E_TEST_EMAIL ?? "";
  const password = process.env.E2E_TEST_PASSWORD ?? "";
  const response = await page.request.post("/api/auth/login", { data: { email, password } });
  const body = await response.text().catch(() => "(unreadable)");
  expect(response.status(), `login failed: ${body}`).toBe(200);
  await preserveLoopbackSession(page, response);
}

test.describe("tender API anonymous protection", () => {
  test("protected tender APIs never return anonymous success", async ({ request }) => {
    const endpoints: Array<["get" | "post", string]> = [
      ["post", "/api/tenders/upload-first"],
      ["post", "/api/tenders/fake-id/ai-analyze"],
      ["post", "/api/tenders/fake-id/generate"],
      ["post", "/api/tenders/fake-id/export"],
      ["get", "/api/tenders/fake-id/extraction-quality"],
    ];
    for (const [method, endpoint] of endpoints) {
      const response = method === "get" ? await request.get(endpoint) : await request.post(endpoint);
      expect(response.status(), `${method.toUpperCase()} ${endpoint}`).not.toBeLessThan(300);
    }
  });
});

test.describe("public application smoke", () => {
  test("home and login pages render without a server error", async ({ page }) => {
    for (const path of ["/", "/login"]) {
      const response = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(response?.status() ?? 0, path).toBeLessThan(500);
    }
    await expect(
      page.locator("input[type=email], input[name=email], input[type=password], input[name=password], form").first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("unauthenticated dashboard access is blocked", async ({ page }) => {
    const response = await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    expect(response?.status() ?? 0).toBeLessThan(500);
    await expect(page).toHaveURL(/login|dashboard/);
    if (/dashboard/.test(page.url())) {
      await expect(page.getByText(/login|sign in|unauthorized/i).first()).toBeVisible({ timeout: 5_000 });
    }
  });
});

test.describe("authenticated intake and precondition gates", () => {
  test.skip(!FULL, "Set E2E_FULL_AUTH=true with an isolated seeded database");

  test("validated source intake persists and generation remains gated before analysis", async ({ page }) => {
    await login(page);

    const sourceText = [
      "REQUEST FOR PROPOSAL — ENGINEERING CONSULTANCY SERVICES",
      "Reference: E2E-RFP-2026-001",
      "The consultant shall submit a technical proposal and a separate financial proposal.",
      "The submission deadline and client details must be verified from the tender document.",
    ].join("\n");

    const upload = await page.request.post("/api/tenders/upload-first", {
      multipart: {
        title: "Authenticated E2E Intake",
        reference: "E2E-RFP-2026-001",
        file: {
          name: "authenticated-intake.txt",
          mimeType: "text/plain",
          buffer: Buffer.from(sourceText, "utf8"),
        },
      },
    });
    const uploadBody = await upload.json().catch(() => null);
    expect(upload.status(), JSON.stringify(uploadBody)).toBe(201);
    expect(uploadBody).toMatchObject({ success: true, uploadedFiles: 1 });
    expect(typeof uploadBody.tenderId).toBe("string");

    const tender = await page.request.get(`/api/tenders/${uploadBody.tenderId}`);
    expect(tender.status()).toBe(200);
    const tenderBody = await tender.json();
    expect(tenderBody.title).toBe("Authenticated E2E Intake");
    expect(tenderBody.stage).toBe("TENDER_INTAKE");
    expect(tenderBody.files).toHaveLength(1);
    expect(tenderBody.files[0].originalFileName).toBe("authenticated-intake.txt");

    const generate = await page.request.post(`/api/tenders/${uploadBody.tenderId}/generate`, { data: {} });
    expect([400, 409, 422]).toContain(generate.status());

    const exportResponse = await page.request.post(`/api/tenders/${uploadBody.tenderId}/export`, { data: {} });
    expect([400, 409, 422]).toContain(exportResponse.status());
  });
});
