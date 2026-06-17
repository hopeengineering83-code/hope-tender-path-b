import { test, expect, type Page } from "@playwright/test";

const FULL = process.env.E2E_FULL_AUTH === "true";
const PRIMARY_TENDER_ID = "11111111-1111-4111-8111-111111111111";
const SECONDARY_TENDER_ID = "22222222-2222-4222-8222-222222222222";

async function login(page: Page, email: string, password: string) {
  const response = await page.request.post("/api/auth/login", { data: { email, password } });
  const body = await response.text().catch(() => "(unreadable)");
  expect(response.status(), `login failed: ${body}`).toBe(200);
}

test.describe("authenticated cross-user isolation", () => {
  test.skip(!FULL, "Set E2E_FULL_AUTH=true with the isolated two-user seed");

  const primaryEmail = process.env.E2E_TEST_EMAIL ?? "";
  const primaryPassword = process.env.E2E_TEST_PASSWORD ?? "";
  const secondaryEmail = process.env.E2E_SECOND_EMAIL ?? "";
  const secondaryPassword = process.env.E2E_SECOND_PASSWORD ?? "";

  test("anonymous tender access is rejected", async ({ request }) => {
    const response = await request.get(`/api/tenders/${PRIMARY_TENDER_ID}`);
    expect(response.status()).toBe(401);
  });

  test("primary user can read its own fixture but not the secondary fixture", async ({ page }) => {
    await login(page, primaryEmail, primaryPassword);

    const own = await page.request.get(`/api/tenders/${PRIMARY_TENDER_ID}`);
    expect(own.status()).toBe(200);
    expect((await own.json()).title).toBe("Primary Owner Fixture");

    const other = await page.request.get(`/api/tenders/${SECONDARY_TENDER_ID}`);
    expect(other.status()).toBe(404);
    expect(await other.json()).toMatchObject({ error: "Not found" });
  });

  test("primary user cannot mutate or share the secondary fixture", async ({ page }) => {
    await login(page, primaryEmail, primaryPassword);

    const update = await page.request.put(`/api/tenders/${SECONDARY_TENDER_ID}`, {
      data: { title: "Cross-user overwrite attempt" },
    });
    expect(update.status()).toBe(404);

    const share = await page.request.post(`/api/tenders/${SECONDARY_TENDER_ID}/share`, {
      data: { label: "Cross-user share attempt" },
    });
    expect(share.status()).toBe(404);

    const verify = await page.request.get(`/api/tenders/${SECONDARY_TENDER_ID}`);
    expect(verify.status()).toBe(404);
  });

  test("secondary owner retains access and the attempted overwrite did not occur", async ({ page }) => {
    await login(page, secondaryEmail, secondaryPassword);

    const own = await page.request.get(`/api/tenders/${SECONDARY_TENDER_ID}`);
    expect(own.status()).toBe(200);
    expect((await own.json()).title).toBe("Secondary Owner Private Tender");

    const primary = await page.request.get(`/api/tenders/${PRIMARY_TENDER_ID}`);
    expect(primary.status()).toBe(404);
  });
});
