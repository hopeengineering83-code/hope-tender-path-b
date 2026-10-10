import { anonymousTest as test, expect } from "./auth-helper";

const MISSING_VALID_TOKEN = "missingShareToken00000000000000000000";

test.describe("shared tender link recovery", () => {
  test("malformed public link fails safely before lookup and provides recovery actions", async ({ page }) => {
    await page.goto("/share/incomplete", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Shared Link Unavailable" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How to regain access" })).toBeVisible();
    await expect(page.getByText(/check that the complete link was copied/i)).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in to Hope Tender" })).toHaveAttribute("href", "/login");
    await expect(page.getByRole("link", { name: "Return to home page" })).toHaveAttribute("href", "/");
    await expect(page.getByText(/signing in does not restore this link/i)).toBeVisible();
    await expect(page.getByText("incomplete", { exact: true })).toHaveCount(0);
  });

  test("well-formed but unknown link uses the same private recovery state", async ({ page }) => {
    await page.goto(`/share/${MISSING_VALID_TOKEN}`, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Shared Link Unavailable" })).toBeVisible();
    await expect(page.getByText(/ask the sender to create a new shared link/i)).toBeVisible();
    await expect(page.getByText(MISSING_VALID_TOKEN, { exact: true })).toHaveCount(0);
  });

  test("recovery page is usable without horizontal overflow on a 390px mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/share/incomplete", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Shared Link Unavailable" })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);

    const signIn = page.getByRole("link", { name: "Sign in to Hope Tender" });
    const home = page.getByRole("link", { name: "Return to home page" });
    await expect(signIn).toBeVisible();
    await expect(home).toBeVisible();
    expect((await signIn.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect((await home.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
