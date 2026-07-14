import { test, expect, type Browser } from "@playwright/test";
import { injectSavedSessionIntoContext } from "./auth-helper";

const FULL = process.env.E2E_FULL_AUTH === "true";
const PRIMARY_TENDER_ID = "11111111-1111-4111-8111-111111111111";
const SECONDARY_TENDER_ID = "22222222-2222-4222-8222-222222222222";
const SECONDARY_DOCUMENT_ID = "33333333-3333-4333-8333-333333333333";
const SECONDARY_FILE_ID = "44444444-4444-4444-8444-444444444444";

function expectHiddenOrForbidden(status: number) {
  expect([403, 404]).toContain(status);
}

/**
 * Opens a fresh, independent browser context authenticated as the given
 * saved account. Each caller gets its own cookie jar — no context is ever
 * mutated from one identity into another, so primary and secondary can be
 * used simultaneously without any risk of cross-contamination.
 */
async function openIsolatedContext(browser: Browser, savedSessionFile: string) {
  const context = await browser.newContext();
  await injectSavedSessionIntoContext(context, savedSessionFile);
  return context;
}

test.describe("authenticated cross-user isolation", () => {
  test.skip(!FULL, "Set E2E_FULL_AUTH=true with the isolated two-user seed");

  test("blocks supplied foreign IDs and preserves the secondary owner's resources", async ({ browser, request }) => {
    const anonymous = await request.get(`/api/tenders/${PRIMARY_TENDER_ID}`);
    expect(anonymous.status()).toBe(401);

    // Two genuinely separate, simultaneous contexts — primary and secondary
    // never share a cookie jar and neither is ever mutated into the other.
    const primaryContext = await openIsolatedContext(browser, "primary-loopback.json");
    const secondaryContext = await openIsolatedContext(browser, "secondary-loopback.json");

    try {
      const primaryPage = await primaryContext.newPage();
      await primaryPage.goto("/dashboard");
      await primaryPage.waitForLoadState("networkidle");

      const own = await primaryPage.request.get(`/api/tenders/${PRIMARY_TENDER_ID}`);
      expect(own.status()).toBe(200);
      expect((await own.json()).title).toBe("Primary Owner Fixture");

      const other = await primaryPage.request.get(`/api/tenders/${SECONDARY_TENDER_ID}`);
      expect(other.status()).toBe(404);
      expect(await other.json()).toMatchObject({ error: "Not found" });

      const update = await primaryPage.request.put(`/api/tenders/${SECONDARY_TENDER_ID}`, {
        data: { title: "Cross-user overwrite attempt" },
      });
      expect(update.status()).toBe(404);

      const share = await primaryPage.request.post(`/api/tenders/${SECONDARY_TENDER_ID}/share`, {
        data: { label: "Cross-user share attempt" },
      });
      expect(share.status()).toBe(404);

      const attach = await primaryPage.request.post(
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

      const readFile = await primaryPage.request.get(
        `/api/tenders/${PRIMARY_TENDER_ID}/files/${SECONDARY_FILE_ID}`,
      );
      expectHiddenOrForbidden(readFile.status());

      const deleteFile = await primaryPage.request.delete(
        `/api/tenders/${PRIMARY_TENDER_ID}/files/${SECONDARY_FILE_ID}`,
      );
      expectHiddenOrForbidden(deleteFile.status());

      const finalize = await primaryPage.request.post(
        `/api/tenders/${PRIMARY_TENDER_ID}/finalize-pdf`,
        { data: { docId: SECONDARY_DOCUMENT_ID } },
      );
      expectHiddenOrForbidden(finalize.status());
      expect(await finalize.json()).toMatchObject({ code: "PDF_SOURCE_NOT_FOUND" });

      const exportAttempt = await primaryPage.request.post(`/api/tenders/${SECONDARY_TENDER_ID}/export`);
      expectHiddenOrForbidden(exportAttempt.status());

      const downloadAttempt = await primaryPage.request.get(`/api/tenders/${SECONDARY_TENDER_ID}/download`);
      expectHiddenOrForbidden(downloadAttempt.status());

      // Secondary identity, evaluated concurrently in its own isolated
      // context — primary's context and page above are untouched by this.
      const secondaryPage = await secondaryContext.newPage();
      await secondaryPage.goto("/dashboard");
      await secondaryPage.waitForLoadState("networkidle");

      const secondaryOwn = await secondaryPage.request.get(`/api/tenders/${SECONDARY_TENDER_ID}`);
      expect(secondaryOwn.status()).toBe(200);
      const body = await secondaryOwn.json();
      expect(body.title).toBe("Secondary Owner Private Tender");

      // The tender dashboard intentionally omits PLANNED document rows. Verify the
      // seeded row through the owner-scoped document endpoint instead, which also
      // proves the foreign attach/finalize attempts above did not alter review state.
      const secondaryDocument = await secondaryPage.request.get(
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

      const primaryAsSecondary = await secondaryPage.request.get(`/api/tenders/${PRIMARY_TENDER_ID}`);
      expect(primaryAsSecondary.status()).toBe(404);

      // Final proof of isolation: the primary context's own session is still
      // primary's — it was never mutated by anything done in the secondary
      // context above.
      const primaryStillOwn = await primaryPage.request.get(`/api/tenders/${PRIMARY_TENDER_ID}`);
      expect(primaryStillOwn.status()).toBe(200);
      expect((await primaryStillOwn.json()).title).toBe("Primary Owner Fixture");
    } finally {
      await primaryContext.close();
      await secondaryContext.close();
    }
  });
});
