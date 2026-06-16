import { test, expect } from "@playwright/test";

// Pipeline E2E tests — cover the tender workflow from upload through export.
//
// Two modes:
//   SMOKE (default): anonymous contract and basic UI availability. This mode is
//                    deterministic in CI and does not require a seeded account.
//   FULL (E2E_FULL_AUTH=true): authenticated workflow checks for seeded test DBs.

const FULL = process.env.E2E_FULL_AUTH === "true";

// ─── Smoke tests (always run) ────────────────────────────────────────────────

test.describe("Pipeline API — anonymous protection contract", () => {
  test("protected tender APIs do not succeed without a session", async ({ request }) => {
    const endpoints: Array<["get" | "post", string]> = [
      ["post", "/api/tenders/upload-first"],
      ["post", "/api/tenders/fake-id/ai-analyze"],
      ["post", "/api/tenders/fake-id/generate"],
      ["post", "/api/tenders/fake-id/export"],
      ["get", "/api/tenders/fake-id/extraction-quality"],
    ];

    for (const [method, endpoint] of endpoints) {
      const res = method === "get" ? await request.get(endpoint) : await request.post(endpoint);
      expect(res.status(), `${method.toUpperCase()} ${endpoint} should not return anonymous success`).not.toBeLessThan(300);
    }
  });
});

test.describe("Pipeline UI — structural smoke tests", () => {
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

// ─── Full authenticated pipeline (requires E2E_FULL_AUTH=true + test DB) ─────

test.describe("Full pipeline — upload → analyze → generate → export", () => {
  test.skip(!FULL, "Set E2E_FULL_AUTH=true to run full pipeline tests");

  const email = process.env.E2E_TEST_EMAIL ?? "test@example.com";
  const password = process.env.E2E_TEST_PASSWORD ?? "testpassword";

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.fill("input[type=email], input[name=email]", email);
    await page.fill("input[type=password], input[name=password]", password);
    const [loginResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/auth/login"), { timeout: 15_000 }),
      page.click("button[type=submit]"),
    ]);
    if (loginResp.status() !== 200) {
      const body = await loginResp.text().catch(() => "(unreadable)");
      throw new Error(`Login failed: status=${loginResp.status()} body=${body}`);
    }
    await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 });
  });

  test("Step 1 — Upload creates tender and shows Extraction Quality panel", async ({ page }) => {
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
    // "Extraction quality" appears in multiple places (panel heading, label, body text).
    // Use .first() to avoid Playwright strict-mode violation.
    await expect(page.locator("text=Extraction quality").first()).toBeVisible({ timeout: 15000 });
  });

  test("Step 2 — Analysis stage section is present and gate state shown", async ({ page }) => {
    await page.goto("/dashboard");
    await page.locator("a[href*='/dashboard/tenders/']").first().click();
    await expect(page).toHaveURL(/\/dashboard\/tenders\/[a-z0-9-]+/);
    // The "Analysis and engine" WorkflowStage summary is always visible (even when collapsed).
    // This confirms the AI/engine analysis section is present on the page.
    await expect(page.locator("text=Analysis and engine")).toBeVisible({ timeout: 5000 });
  });

  test("Step 3 — Generate Docs is gated before AI Analyze runs", async ({ page }) => {
    await page.goto("/dashboard");
    await page.locator("a[href*='/dashboard/tenders/']").first().click();
    const generateBtn = page.locator("button:has-text('Generate'), button:has-text('Generate Docs')");
    if (await generateBtn.isVisible()) {
      const isDisabled = await generateBtn.isDisabled();
      if (!isDisabled) {
        const [response] = await Promise.all([
          page.waitForResponse((r) => r.url().includes("/generate")),
          generateBtn.click(),
        ]);
        expect([400, 422]).toContain(response.status());
      }
    }
  });

  test("Step 4 — Export is gated before documents are generated", async ({ page }) => {
    await page.goto("/dashboard");
    await page.locator("a[href*='/dashboard/tenders/']").first().click();
    const exportBtn = page.locator("button:has-text('Export'), button:has-text('Prepare Export'), button:has-text('ZIP')");
    if (await exportBtn.isVisible()) {
      const isDisabled = await exportBtn.isDisabled();
      if (!isDisabled) {
        const [response] = await Promise.all([
          page.waitForResponse((r) => r.url().includes("/export")),
          exportBtn.click(),
        ]);
        expect([400, 409, 422]).toContain(response.status());
      }
    }
  });
});
