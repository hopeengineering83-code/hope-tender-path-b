import { test, expect } from "@playwright/test";

// Tender workflow contract tests.
//
// SMOKE mode checks anonymous protection and basic UI availability.
// AUTHENTICATED mode checks sign-in, one PDF intake, extraction-panel visibility,
// and precondition gates. It does NOT yet prove actual AI execution, document
// generation, DOCX/PDF validity, final ZIP contents, or interruption/resume.

const FULL = process.env.E2E_FULL_AUTH === "true";

test.describe("Tender API anonymous protection", () => {
  test("protected tender APIs do not succeed without a session", async ({ request }) => {
    const endpoints: Array<["get" | "post", string]> = [
      ["post", "/api/tenders/upload-first"],
      ["post", "/api/tenders/fake-id/ai-analyze"],
      ["post", "/api/tenders/fake-id/generate"],
      ["post", "/api/tenders/fake-id/export"],
      ["get", "/api/tenders/fake-id/extraction-quality"],
    ];

    for (const [method, endpoint] of endpoints) {
      const response = method === "get" ? await request.get(endpoint) : await request.post(endpoint);
      expect(response.status(), `${method.toUpperCase()} ${endpoint} should not return anonymous success`).not.toBeLessThan(300);
    }
  });
});

test.describe("Tender UI structural smoke checks", () => {
  test("home page responds", async ({ page }) => {
    const response = await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(response?.status() ?? 0).toBeLessThan(500);
  });

  test("unauthenticated dashboard access is blocked or redirected", async ({ page }) => {
    const response = await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    expect(response?.status() ?? 0).toBeLessThan(500);
    await expect(page).toHaveURL(/login|dashboard/);
    if (/dashboard/.test(page.url())) {
      await expect(page.locator("text=/login|sign in|unauthorized/i").first()).toBeVisible({ timeout: 5000 });
    }
  });

  test("login page renders an authentication surface", async ({ page }) => {
    const response = await page.goto("/login", { waitUntil: "domcontentloaded" });
    expect(response?.status() ?? 0).toBeLessThan(500);
    const authSurface = page
      .locator("input[type=email], input[name=email], input[type=password], input[name=password], form")
      .or(page.getByText(/sign in|login/i))
      .first();
    await expect(authSurface).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Authenticated intake and precondition gates", () => {
  test.skip(!FULL, "Set E2E_FULL_AUTH=true to run authenticated intake tests");

  const email = process.env.E2E_TEST_EMAIL ?? "test@example.com";
  const password = process.env.E2E_TEST_PASSWORD ?? "testpassword";

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.fill("input[type=email], input[name=email]", email);
    await page.fill("input[type=password], input[name=password]", password);
    const [loginResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().includes("/api/auth/login"), { timeout: 15_000 }),
      page.click("button[type=submit]"),
    ]);
    if (loginResponse.status() !== 200) {
      const body = await loginResponse.text().catch(() => "(unreadable)");
      throw new Error(`Login failed: status=${loginResponse.status()} body=${body}`);
    }
    await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 });
  });

  test("PDF intake creates a tender and shows extraction quality", async ({ page }) => {
    await page.goto("/dashboard/tenders/new");
    const fileInput = page.locator("input[type=file]");
    await fileInput.setInputFiles({
      name: "sample.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(
        "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
        "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
        "3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n" +
        "4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 100 700 Td (Tender Document) Tj ET\nendstream\nendobj\n" +
        "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n" +
        "xref\n0 6\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000274 00000 n\n0000000369 00000 n\n" +
        "trailer<</Size 6/Root 1 0 R>>\nstartxref\n441\n%%EOF",
      ),
    });
    await page.fill("input[name=title], input[placeholder*=title i]", "E2E Test Tender");
    await page.click("button[type=submit], button:has-text('Upload'), button:has-text('Create')");
    await expect(page).toHaveURL(/\/dashboard\/tenders\/[a-z0-9-]+/);
    await expect(page.locator("text=Extraction quality").first()).toBeVisible({ timeout: 15000 });
  });

  test("analysis stage is present", async ({ page }) => {
    await page.goto("/dashboard");
    await page.locator("a[href*='/dashboard/tenders/'][href*='-']").first().click();
    await expect(page).toHaveURL(/\/dashboard\/tenders\/[a-z0-9]+-[a-z0-9-]+/, { timeout: 15_000 });
    await expect(page.locator("text=Analysis and engine")).toBeVisible({ timeout: 5000 });
  });

  test("generation remains gated before analysis", async ({ page }) => {
    await page.goto("/dashboard");
    await page.locator("a[href*='/dashboard/tenders/'][href*='-']").first().click();
    const generateButton = page.locator("button:has-text('Generate'), button:has-text('Generate Docs')");
    if (await generateButton.isVisible()) {
      const disabled = await generateButton.isDisabled();
      if (!disabled) {
        const [response] = await Promise.all([
          page.waitForResponse((candidate) => candidate.url().includes("/generate")),
          generateButton.click(),
        ]);
        expect([400, 422]).toContain(response.status());
      }
    }
  });

  test("export remains gated before document generation", async ({ page }) => {
    await page.goto("/dashboard");
    await page.locator("a[href*='/dashboard/tenders/'][href*='-']").first().click();
    const exportButton = page.locator("button:has-text('Export'), button:has-text('Prepare Export'), button:has-text('ZIP')");
    if (await exportButton.isVisible()) {
      const disabled = await exportButton.isDisabled();
      if (!disabled) {
        const [response] = await Promise.all([
          page.waitForResponse((candidate) => candidate.url().includes("/export")),
          exportButton.click(),
        ]);
        expect([400, 409, 422]).toContain(response.status());
      }
    }
  });
});
