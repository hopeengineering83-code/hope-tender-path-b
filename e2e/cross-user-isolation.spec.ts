import { test, expect, type APIResponse, type Page } from "@playwright/test";

const FULL = process.env.E2E_FULL_AUTH === "true";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const PRIMARY_TENDER_ID = "11111111-1111-4111-8111-111111111111";
const SECONDARY_TENDER_ID = "22222222-2222-4222-8222-222222222222";
const SECONDARY_DOCUMENT_ID = "33333333-3333-4333-8333-333333333333";
const SECONDARY_FILE_ID = "44444444-4444-4444-8444-444444444444";

async function preserveLoopbackSession(page: Page, response: APIResponse) {
  const origin = new URL(baseURL);
  if (origin.protocol !== "http:") return;

  const sessionHeader = response.headersArray().find(
    ({ name, value }) => name.toLowerCase() === "set-cookie" && value.startsWith("hope_session="),
  );
  expect(sessionHeader, "login response must set the session cookie").toBeTruthy();
  expect(
    sessionHeader?.value,
    "production-like login must retain the Secure cookie attribute",
  ).toMatch(/;\s*Secure(?:;|$)/i);

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

async function login(page: Page, email: string, password: string) {
  const response = await page.request.post("/api/auth/login", {
    data: { email, password },
  });
  const body = await response.text().catch(() => "(unreadable)");
  expect(response.status(), `login failed: ${body}`).toBe(200);
  await preserveLoopbackSession(page, response);
}

function expectHiddenOrForbidden(status: number) {
  expect([403, 404]).toContain(status);
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
  });

  test("primary user cannot attach bytes to a foreign generated-document ID", async ({ page }) => {
    await login(page, primaryEmail, primaryPassword);

    const response = await page.request.post(
      `/api/tenders/${PRIMARY_TENDER_ID}/documents/${SECONDARY_DOCUMENT_ID}/attach-original`,
      {
        multipart: {
          file: {
            name: "Secondary-Private-Document.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            buffer: Buffer.concat([
              Buffer.from([0x50, 0x4b, 0x03, 0x04]),
              Buffer.from("foreign-write-attempt"),
            ]),
          },
        },
      },
    );

    expectHiddenOrForbidden(response.status());
  });

  test("primary user cannot read or delete a foreign TenderFile ID through its own tender", async ({ page }) => {
    await login(page, primaryEmail, primaryPassword);

    const read = await page.request.get(
      `/api/tenders/${PRIMARY_TENDER_ID}/files/${SECONDARY_FILE_ID}`,
    );
    expectHiddenOrForbidden(read.status());

    const remove = await page.request.delete(
      `/api/tenders/${PRIMARY_TENDER_ID}/files/${SECONDARY_FILE_ID}`,
    );
    expectHiddenOrForbidden(remove.status());
  });

  test("primary user cannot finalize a foreign document ID as its own PDF", async ({ page }) => {
    await login(page, primaryEmail, primaryPassword);

    const response = await page.request.post(
      `/api/tenders/${PRIMARY_TENDER_ID}/finalize-pdf`,
      { data: { docId: SECONDARY_DOCUMENT_ID } },
    );

    expectHiddenOrForbidden(response.status());
    expect(await response.json()).toMatchObject({ code: "PDF_SOURCE_NOT_FOUND" });
  });

  test("primary user cannot trigger export or final ZIP for the foreign tender", async ({ page }) => {
    await login(page, primaryEmail, primaryPassword);

    const exportAttempt = await page.request.post(
      `/api/tenders/${SECONDARY_TENDER_ID}/export`,
    );
    expectHiddenOrForbidden(exportAttempt.status());

    const downloadAttempt = await page.request.get(
      `/api/tenders/${SECONDARY_TENDER_ID}/download`,
    );
    expectHiddenOrForbidden(downloadAttempt.status());
  });

  test("secondary owner retains its tender, document, and file after every attack", async ({ page }) => {
    await login(page, secondaryEmail, secondaryPassword);

    const own = await page.request.get(`/api/tenders/${SECONDARY_TENDER_ID}`);
    expect(own.status()).toBe(200);
    const body = await own.json();
    expect(body.title).toBe("Secondary Owner Private Tender");
    expect(body.generatedDocuments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: SECONDARY_DOCUMENT_ID,
          generationStatus: "PLANNED",
          reviewStatus: "PENDING",
        }),
      ]),
    );
    expect(body.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: SECONDARY_FILE_ID,
          deletionStatus: "ACTIVE",
        }),
      ]),
    );

    const primary = await page.request.get(`/api/tenders/${PRIMARY_TENDER_ID}`);
    expect(primary.status()).toBe(404);
  });
});
