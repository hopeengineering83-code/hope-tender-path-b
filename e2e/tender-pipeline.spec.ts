import { primaryTest as test, expect } from "./auth-helper";

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

    // Verify extraction persists — GET /api/tenders/{id}/source-files returns
    // { ok, tenderId, files: [{ fileId, fileName, extractedTextLength, ... }] },
    // not { items: [...] }.
    const filesResponse = await page.request.get(`/api/tenders/${tenderId}/source-files`);
    expect(filesResponse.status()).toBe(200);
    const filesJson = await filesResponse.json() as { ok: boolean; files: Array<{ fileId: string; extractedTextLength: number }> };
    expect(filesJson.ok).toBe(true);
    expect(filesJson.files.length).toBeGreaterThan(0);
    expect(filesJson.files.every((file) => file.fileId && file.extractedTextLength > 0)).toBe(true);

    // Generation must be gated before analysis
    const generateResponse = await page.request.post(`/api/tenders/${tenderId}/generate`);
    expect(generateResponse.status()).toBeGreaterThanOrEqual(400);
  });
});
