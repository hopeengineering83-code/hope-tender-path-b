import { primaryTest as test, expect } from "./auth-helper";
import { waitForDurableTenderExtraction } from "./durable-tender-extraction";

const FULL = process.env.E2E_FULL_AUTH === "true";

// Anonymous tests have been moved to e2e/anonymous/anonymous-access.spec.ts
// This file now contains ONLY authenticated tests.

test.describe("authenticated intake and precondition gates", () => {
  test.skip(!FULL, "Set E2E_FULL_AUTH=true with an isolated seeded database");

  test("validated source intake persists and generation remains gated before analysis", async ({ page }) => {
    // The storage state is set by the global setup / project config.
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    const sourceText = [
      "REQUEST FOR PROPOSAL — ENGINEERING CONSULTANCY SERVICES",
      "Reference: E2E-RFP-2026-001",
      "The consultant shall submit a technical proposal and a separate financial proposal.",
      "The submission deadline and client details must be verified from the tender document.",
    ].join("\n");

    const upload = await page.request.post("/api/tenders/upload-first", {
      multipart: {
        title: "Authenticated E2E Intake",
        reference: "E2E-RFP-2026-001",
        file: {
          name: "authenticated-intake.txt",
          mimeType: "text/plain",
          buffer: Buffer.from(sourceText),
        },
      },
    });

    expect(upload.status(), await upload.text()).toBe(201);
    const intakeJson = await upload.json() as { success: boolean; tenderId: string };
    expect(intakeJson.success).toBe(true);
    const tenderId = intakeJson.tenderId;

    try {
      const extraction = await waitForDurableTenderExtraction({
        request: page.request,
        tenderId,
        expectedFileCount: 1,
      });
      expect(extraction.files).toHaveLength(1);
      expect(extraction.files.every((file) => file.fileId && file.extractedTextLength > 0)).toBe(true);

      // Generation must be gated before promoted AI analysis.
      const generateResponse = await page.request.post(`/api/tenders/${tenderId}/generate`);
      expect(generateResponse.status()).toBeGreaterThanOrEqual(400);
    } finally {
      const cleanup = await page.request.delete(`/api/tenders/${tenderId}`);
      expect([200, 204]).toContain(cleanup.status());
    }
  });
});
