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

  test("blocks supplied foreign IDs and preserves the secondary owner's resources", async ({ page, request }) => {
    const anonymous = await request.get(`/api/tenders/${PRIMARY_TENDER_ID}`);
    expect(anonymous.status()).toBe(401);

    // The primary storage state is already set via the project config.
    // Navigate to dashboard to activate the session cookie in the browser context.
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    const own = await page.request.get(`/api/tenders/${PRIMARY_TENDER_ID}`);
    expect(own.status()).toBe(200);
    expect((await own.json()).title).toBe("Primary Owner Fixture");

    const other = await page.request.get(`/api/tenders/${SECONDARY_TENDER_ID}`);
    expect(other.status()).toBe(404);
    expect(await other.json()).toMatchObject({ error: "Not found" });

    const update = await page.request.put(`/api/tenders/${SECONDARY_TENDER_ID}`, {
      data: { title: "Cross-user overwrite attempt" },
    });
    expect(update.status()).toBe(404);

    const share = await page.request.post(`/api/tenders/${SECONDARY_TENDER_ID}/share`, {
      data: { label: "Cross-user share attempt" },
    });
    expect(share.status()).toBe(404);

    const attach = await page.request.post(
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
    expectHiddenOrForbidden(attach.status());

    const readFile = await page.request.get(
      `/api/tenders/${PRIMARY_TENDER_ID}/files/${SECONDARY_FILE_ID}`,
    );
    expectHiddenOrForbidden(readFile.status());

    const deleteFile = await page.request.delete(
      `/api/tenders/${PRIMARY_TENDER_ID}/files/${SECONDARY_FILE_ID}`,
    );
    expectHiddenOrForbidden(deleteFile.status());

    const finalize = await page.request.post(
      `/api/tenders/${PRIMARY_TENDER_ID}/finalize-pdf`,
      { data: { docId: SECONDARY_DOCUMENT_ID } },
    );
    expectHiddenOrForbidden(finalize.status());
    expect(await finalize.json()).toMatchObject({ code: "PDF_SOURCE_NOT_FOUND" });

    const exportAttempt = await page.request.post(
      `/api/tenders/${SECONDARY_TENDER_ID}/export`,
    );
    expectHiddenOrForbidden(exportAttempt.status());

    const downloadAttempt = await page.request.get(
      `/api/tenders/${SECONDARY_TENDER_ID}/download`,
    );
    expectHiddenOrForbidden(downloadAttempt.status());

    // Switch to the secondary identity using the saved loopback-safe storage state.
    // The global setup saved the secondary session to .auth/secondary-loopback.json
    // with secure: false for loopback HTTP CI.
    await page.context().clearCookies();
    const fs = await import("node:fs");
    const secondaryStatePath = ".auth/secondary-loopback.json";
    const secondaryState = JSON.parse(fs.readFileSync(secondaryStatePath, "utf8"));
    const cookies = secondaryState.cookies || [];
    if (cookies.length > 0) {
      await page.context().addCookies(cookies.map((c: any) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || "/",
        httpOnly: c.httpOnly ?? true,
        secure: false, // loopback HTTP
        sameSite: "Lax" as const,
      })));
    }
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    const secondaryOwn = await page.request.get(`/api/tenders/${SECONDARY_TENDER_ID}`);
    expect(secondaryOwn.status()).toBe(200);
    const body = await secondaryOwn.json();
    expect(body.title).toBe("Secondary Owner Private Tender");

    // The tender dashboard intentionally omits PLANNED document rows. Verify the
    // seeded row through the owner-scoped document endpoint instead, which also
    // proves the foreign attach/finalize attempts did not alter review state.
    const secondaryDocument = await page.request.get(
      `/api/tenders/${SECONDARY_TENDER_ID}/documents/${SECONDARY_DOCUMENT_ID}`,
    );
    expect(secondaryDocument.status()).toBe(200);
    expect(await secondaryDocument.json()).toMatchObject({
      document: {
        id: SECONDARY_DOCUMENT_ID,
        reviewStatus: "PENDING",
      },
    });

    expect(body.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: SECONDARY_FILE_ID,
          deletionStatus: "ACTIVE",
        }),
      ]),
    );

    const primaryAsSecondary = await page.request.get(`/api/tenders/${PRIMARY_TENDER_ID}`);
    expect(primaryAsSecondary.status()).toBe(404);
  });
});
