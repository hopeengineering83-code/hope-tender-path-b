import { test, expect } from "@playwright/test";

// Pipeline E2E tests — cover the full tender workflow from upload through export.
//
// Two test modes:
//   SMOKE (default, no auth):  Structural checks — correct redirects, API contract,
//                              gate response codes. Safe for CI without a real DB.
//   FULL (E2E_FULL_AUTH=true): Requires a seeded test account and a running server
//                              with DATABASE_URL + at least one AI key configured.
//                              Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD in env.

const FULL = process.env.E2E_FULL_AUTH === "true";

// ─── Smoke tests (always run) ────────────────────────────────────────────────

test.describe("Pipeline API — unauthenticated contract", () => {
  test("POST /api/tenders/upload-first returns 401 without session", async ({ request }) => {
    const form = new FormData();
    form.append("title", "Test Tender");
    const res = await request.post("/api/tenders/upload-first", { multipart: {} });
    expect(res.status()).toBe(401);
  });

  test("POST /api/tenders/fake-id/ai-analyze returns 401 without session", async ({ request }) => {
    const res = await request.post("/api/tenders/fake-id/ai-analyze");
    expect(res.status()).toBe(401);
  });

  test("POST /api/tenders/fake-id/generate returns 401 without session", async ({ request }) => {
    const res = await request.post("/api/tenders/fake-id/generate");
    expect(res.status()).toBe(401);
  });

  test("POST /api/tenders/fake-id/export returns 401 without session", async ({ request }) => {
    const res = await request.post("/api/tenders/fake-id/export");
    expect(res.status()).toBe(401);
  });

  test("GET /api/tenders/fake-id/extraction-quality returns 401 without session", async ({ request }) => {
    const res = await request.get("/api/tenders/fake-id/extraction-quality");
    expect(res.status()).toBe(401);
  });
});

test.describe("Pipeline UI — structural smoke tests", () => {
  test("unauthenticated user is redirected to login from dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/login/);
  });

  test("unauthenticated user is redirected to login from tender detail", async ({ page }) => {
    await page.goto("/dashboard/tenders/fake-id");
    await expect(page).toHaveURL(/login/);
  });

  test("login page renders form elements", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("input[type=email], input[name=email]")).toBeVisible();
    await expect(page.locator("input[type=password], input[name=password]")).toBeVisible();
  });
});

// ─── Full authenticated pipeline (requires E2E_FULL_AUTH=true + test DB) ─────

test.describe("Full pipeline — upload → analyze → generate → export", () => {
  test.skip(!FULL, "Set E2E_FULL_AUTH=true to run full pipeline tests");

  const email = process.env.E2E_TEST_EMAIL ?? "test@example.com";
  const password = process.env.E2E_TEST_PASSWORD ?? "testpassword";

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill("input[type=email], input[name=email]", email);
    await page.fill("input[type=password], input[name=password]", password);
    await page.click("button[type=submit]");
    await expect(page).toHaveURL(/dashboard/);
  });

  test("Step 1 — Upload creates tender and shows Extraction Quality panel", async ({ page }) => {
    await page.goto("/dashboard/tenders/new");
    const fileInput = page.locator("input[type=file]");
    await fileInput.setInputFiles({
      name: "sample.pdf",
      mimeType: "application/pdf",
      // Minimal valid PDF with one page of text
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
    // Should land on tender detail page
    await expect(page).toHaveURL(/\/dashboard\/tenders\/[a-z0-9-]+/);
    // Extraction Quality panel must be visible
    await expect(page.locator("text=Extraction quality")).toBeVisible({ timeout: 15000 });
  });

  test("Step 2 — AI Analyze button is present and gate state shown", async ({ page }) => {
    // Navigate to most recent tender
    await page.goto("/dashboard");
    await page.locator("a[href*='/dashboard/tenders/']").first().click();
    await expect(page).toHaveURL(/\/dashboard\/tenders\/[a-z0-9-]+/);
    // AI Analyze button must exist
    await expect(page.locator("button:has-text('AI Analyze'), button:has-text('Run Analysis'), button:has-text('Analyze')")).toBeVisible({ timeout: 5000 });
  });

  test("Step 3 — Generate Docs is gated before AI Analyze runs", async ({ page }) => {
    await page.goto("/dashboard");
    await page.locator("a[href*='/dashboard/tenders/']").first().click();
    // Generate Docs button should be disabled or show a gate message before analysis
    const generateBtn = page.locator("button:has-text('Generate'), button:has-text('Generate Docs')");
    if (await generateBtn.isVisible()) {
      // If visible, it should be disabled or blocked by a gate
      const isDisabled = await generateBtn.isDisabled();
      if (!isDisabled) {
        // Click and verify it returns a gate error, not a success
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
        // Gate must block — 400, 409, or 422
        expect([400, 409, 422]).toContain(response.status());
      }
    }
  });
});
