import { primaryTest as test, expect } from "./auth-helper";

test.describe("single company profile editor", () => {
  test("Knowledge Vault suppresses the duplicate inline editor and directs to the labeled editor", async ({ page }) => {
    await page.goto("/dashboard/company", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Company Knowledge Vault" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "One company profile editor" })).toBeVisible();
    await expect(page.getByText(/edited only in the labeled Company Profile Editor/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save Profile" })).toHaveCount(0);

    const editorLink = page.getByRole("link", { name: "Open Company Profile Editor" });
    await expect(editorLink).toBeVisible();
    await expect(editorLink).toHaveAttribute("href", "/dashboard/company/profile");
    const box = await editorLink.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    await editorLink.click();
    await expect(page).toHaveURL(/\/dashboard\/company\/profile\/?$/);
    await expect(page.getByRole("heading", { name: "Company Profile Editor" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save labeled company profile" })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "One company profile editor" })).toHaveCount(0);
  });

  test("documents, experts, projects, and compliance tabs remain available in the Knowledge Vault", async ({ page }) => {
    await page.goto("/dashboard/company", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Company Knowledge Vault" })).toBeVisible();

    await expect(page.getByRole("button", { name: /Documents/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Experts/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Projects/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Compliance & Legal/ })).toBeVisible();
  });

  test("authority notice and editor action fit a 390px mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard/company", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "One company profile editor" })).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
    expect((await page.getByRole("link", { name: "Open Company Profile Editor" }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
