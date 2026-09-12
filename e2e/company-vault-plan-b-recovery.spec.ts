import { primaryTest as test, expect } from "./auth-helper";

function companyPayload(expertCount = 0, projectCount = 0) {
  return {
    id: "company-vault-browser-test",
    name: "Company Vault Browser Test",
    knowledgeMode: "FULL_LIBRARY",
    experts: Array.from({ length: expertCount }, (_, index) => ({
      id: `expert-${index + 1}`,
      fullName: `Expert ${index + 1}`,
      trustLevel: "SOURCE_VERIFIED",
    })),
    projects: Array.from({ length: projectCount }, (_, index) => ({
      id: `project-${index + 1}`,
      name: `Project ${index + 1}`,
      trustLevel: "SOURCE_VERIFIED",
    })),
    expertCount,
    projectCount,
  };
}

test.describe("Company Vault upload and Plan B recovery UX", () => {
  test("supported sources reach /api/upload, appear immediately, and wake VAULT_INGEST", async ({ page }) => {
    const uploadedNames: string[] = [];
    let uploadRequests = 0;
    let vaultWorkerRequests = 0;

    await page.route(/\/api\/company\?*$/, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(companyPayload()) });
    });
    await page.route("**/api/company/assets?limit=50", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assets: [] }) });
    });
    await page.route("**/api/company/ingestion-readiness", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ totals: { reviewedExperts: 0, reviewedProjects: 0 } }),
      });
    });
    await page.route("**/api/company/documents?limit=50", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: uploadedNames.map((name, index) => ({
            id: `uploaded-${index + 1}`,
            fileName: name,
            originalFileName: name,
            mimeType: "application/octet-stream",
            size: 128,
            category: "OTHER",
            aiExtractionStatus: "PENDING",
            extractedTextLength: 0,
            hasInlineFileContent: true,
            hasPrivateStorage: false,
            createdAt: new Date(2026, 7, 4, 12, index).toISOString(),
          })),
          nextCursor: null,
          hasMore: false,
        }),
      });
    });
    await page.route("**/api/upload", async (route) => {
      uploadRequests += 1;
      const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
      const expectedNames = ["source.pdf", "source.docx", "source.xlsx", "source.csv", "source.txt"];
      const uploadedName = expectedNames.find((name) => body.includes(name));
      if (uploadedName) uploadedNames.push(uploadedName);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          uploaded: 1,
          errors: 0,
          results: [{ success: true }],
          companyImport: { status: "QUEUED", jobId: `vault-job-${uploadRequests}` },
        }),
      });
    });
    await page.route("**/api/ai-jobs/run-next?jobType=VAULT_INGEST", async (route) => {
      vaultWorkerRequests += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    await page.goto("/dashboard/company", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("status").filter({ hasText: "Loading Company Vault" })).toBeHidden({ timeout: 15_000 });

    const fileInput = page.locator('input[type="file"][multiple]').first();
    await fileInput.setInputFiles([
      { name: "source.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\nfixture") },
      { name: "source.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("PK-docx") },
      { name: "source.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("PK-xlsx") },
      { name: "source.csv", mimeType: "text/csv", buffer: Buffer.from("name,value\nHope,1\n") },
      { name: "source.txt", mimeType: "text/plain", buffer: Buffer.from("Company Vault source") },
    ]);

    await expect.poll(() => uploadRequests, { timeout: 15_000 }).toBe(5);
    await expect.poll(() => vaultWorkerRequests, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
    await expect(page.getByRole("status", { name: "Upload progress" }).getByText("Done")).toHaveCount(5);
    await expect(page.getByText("Document stored. Extraction and source-verification queued", { exact: false })).toBeVisible();

    for (const name of ["source.pdf", "source.docx", "source.xlsx", "source.csv", "source.txt"]) {
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    }
  });

  test("invalid JSON upload displays the precise staging-descriptor error", async ({ page }) => {
    await page.route(/\/api\/company\?*$/, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(companyPayload()) });
    });
    await page.route("**/api/company/assets?limit=50", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assets: [] }) });
    });
    await page.route("**/api/company/ingestion-readiness", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ totals: {} }) });
    });
    await page.route("**/api/company/documents?limit=50", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
    });
    await page.route("**/api/upload", async (route) => {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          results: [{
            error: "JSON is a Plan B staging descriptor, not an official Company Vault source. Use Plan B Import for JSON; upload PDF, DOCX, XLSX, CSV, and TXT here.",
          }],
        }),
      });
    });

    await page.goto("/dashboard/company", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("status").filter({ hasText: "Loading Company Vault" })).toBeHidden({ timeout: 15_000 });
    await page.locator('input[type="file"][multiple]').first().setInputFiles({
      name: "plan-b.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"experts":[]}'),
    });

    await expect(page.getByText("JSON is a Plan B staging descriptor", { exact: false })).toBeVisible();
    await expect(page.getByText("PDF, DOCX, XLSX, CSV, and TXT", { exact: false })).toBeVisible();
  });

  test("Plan B reports RESTORED counts, refreshed 28/114 totals, staged descriptors, and one source blocker", async ({ page }) => {
    await page.route("**/api/company/plan-b-import", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          documents: { received: 2, created: 2, updated: 0, skipped: 0 },
          experts: { received: 28, created: 0, updated: 28, skipped: 0 },
          projects: { received: 114, created: 0, updated: 114, skipped: 0 },
          warnings: [
            "Expert A could not be source-verified against stored bytes — imported as AI_DRAFT. Upload the source document it came from.",
            "Project A could not be source-verified against stored bytes — imported as AI_DRAFT. Upload the source document it came from.",
          ],
        }),
      });
    });
    await page.route("**/api/company/plan-b-import/finalize", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          restored: { experts: 28, projects: 114, total: 142 },
          linked: { experts: 27, projects: 113, total: 140 },
          sourceVerified: { experts: 27, projects: 113, total: 140 },
          activeCounts: { experts: 28, projects: 114 },
          sourceDescriptorsStaged: 2,
          missingOriginalSources: 1,
          sourceBlocker: "Original source evidence is absent for 1 declared source. Upload the original file: Missing Original.pdf.",
          verificationBlocker: null,
        }),
      });
    });
    await page.route(/\/api\/company\?*$/, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(companyPayload(28, 114)) });
    });

    await page.goto("/dashboard/company/plan-b-import", { waitUntil: "domcontentloaded" });
    await page.locator("#plan-b-text").fill(JSON.stringify({
      sourceDocuments: [{ fileName: "Missing Original.pdf" }],
      experts: [{ fullName: "Expert A", rawText: "x".repeat(60), sourceDocument: "Missing Original.pdf" }],
      projects: [{ name: "Project A", rawText: "x".repeat(60), sourceDocument: "Missing Original.pdf" }],
    }));
    await page.getByRole("button", { name: "Import and refresh Company Vault" }).click();

    await expect(page.getByText("Active and visible now:", { exact: false })).toContainText("28 experts");
    await expect(page.getByText("Active and visible now:", { exact: false })).toContainText("114 projects");
    await expect(page.getByRole("columnheader", { name: "Restored" })).toBeVisible();
    await expect(page.getByText("Source descriptors staged", { exact: true })).toBeVisible();
    await expect(page.getByText("2", { exact: true }).last()).toBeVisible();
    await expect(page.getByText("Company source blocker", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Original source evidence is absent for 1 declared source", { exact: false })).toHaveCount(1);
    await expect(page.getByText(/Upload the source document it came from/i)).toHaveCount(0);
  });
});
