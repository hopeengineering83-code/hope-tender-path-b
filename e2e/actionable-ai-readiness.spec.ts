import { primaryTest as test, expect } from "./auth-helper";

test.describe("actionable AI readiness", () => {
  test("admin sees prioritized remediation and direct diagnostic actions", async ({ page }) => {
    await page.goto("/dashboard/admin/ai-readiness", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "AI environment readiness" })).toBeVisible();
    await expect(page.getByRole("region", { name: "AI readiness summary" })).toBeVisible();
    await expect(page.getByText("Active AI providers", { exact: true })).toBeVisible();
    await expect(page.getByText("Required values missing", { exact: true })).toBeVisible();
    await expect(page.getByText("Actions to review", { exact: true })).toBeVisible();

    await expect(page.getByRole("heading", { name: "What to do next" })).toBeVisible();
    await expect(page.getByText(/Settings → Environment Variables/)).toBeVisible();
    await expect(page.getByText(/Redeploy the same environment/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Open System Status" })).toHaveAttribute("href", "/dashboard/system");
    await expect(page.getByRole("link", { name: "Open System Safety Center" })).toHaveAttribute("href", "/dashboard/admin/safety-center");
  });

  test("low-level environment inventory stays collapsed until the admin requests it", async ({ page }) => {
    await page.goto("/dashboard/admin/ai-readiness", { waitUntil: "domcontentloaded" });

    const details = page.locator("details").filter({ hasText: "Environment variable details" });
    await expect(details).not.toHaveAttribute("open", "");
    await expect(page.getByRole("region", { name: "Environment variables" })).toBeHidden();

    await details.locator("summary").click();
    await expect(details).toHaveAttribute("open", "");
    await expect(page.getByRole("region", { name: "Environment variables" })).toBeVisible();
    await expect(page.getByText("Secret values", { exact: false })).toBeVisible();
  });

  test("remediation controls remain usable at a 390px mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard/admin/ai-readiness", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "What to do next" })).toBeVisible();
    const systemStatus = page.getByRole("link", { name: "Open System Status" });
    const safetyCenter = page.getByRole("link", { name: "Open System Safety Center" });
    expect((await systemStatus.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect((await safetyCenter.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  });
});
