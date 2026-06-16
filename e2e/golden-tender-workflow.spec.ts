import { test, expect } from "@playwright/test";

const FULL = process.env.E2E_GOLDEN_AUTH === "true";
const email = process.env.E2E_TEST_EMAIL ?? "e2e-release-integrity@example.test";
const password = process.env.E2E_TEST_PASSWORD ?? "E2E-release-integrity-password-2026";

const tenderText = `
REQUEST FOR PROPOSAL
Reference: RFP-E2E-2026-001
Procuring Entity: Release Integrity Public Agency

SUBMISSION INSTRUCTIONS
The technical proposal and financial proposal must be submitted separately by email to procurement@example.test no later than 30 June 2026. The email subject must contain RFP-E2E-2026-001. The technical proposal must not contain financial information.

MANDATORY ELIGIBILITY REQUIREMENTS
1. Submit a valid business licence and tax clearance certificate.
2. Provide at least three relevant project references completed within the last five years.
3. Nominate a project manager with at least ten years of professional experience.
4. Submit signed declarations and the required forms.

TECHNICAL SCOPE
The consultant shall complete inception, field assessment, design development, stakeholder consultation, detailed engineering, bills of quantities, tender documentation, construction supervision methodology, quality assurance and final reporting.

EVALUATION CRITERIA
Technical approach and methodology: 35 points.
Relevant company experience: 25 points.
Qualifications of key experts: 25 points.
Work plan and quality assurance: 15 points.
Only proposals achieving 70 technical points proceed to financial evaluation.
`;

test.describe.serial("Golden tender workflow — authenticated release contract", () => {
  test.skip(!FULL, "Set E2E_GOLDEN_AUTH=true and seed the isolated E2E account");
  test.setTimeout(120_000);

  test("upload-first → add source file → AI Analyze fallback → readiness gate", async ({ page }) => {
    await page.goto("/login");
    // Wait for React hydration to complete so controlled-input onChange handlers are attached.
    // Without this, page.fill() fires before React event delegation is set up and
    // the email/password state stays empty, causing a 400 or native form POST.
    await page.waitForLoadState("networkidle");
    await page.fill("input[type=email], input[name=email]", email);
    await page.fill("input[type=password], input[name=password]", password);
    await page.click("button[type=submit]");
    await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 });

    const intake = await page.request.post("/api/tenders/upload-first", {
      multipart: {
        title: "Golden Release Integrity Tender",
        reference: "RFP-E2E-2026-001",
        file: {
          name: "golden-tender.txt",
          mimeType: "text/plain",
          buffer: Buffer.from(tenderText),
        },
      },
    });
    expect(intake.status(), await intake.text()).toBe(201);
    const intakeJson = await intake.json() as {
      success: boolean;
      tenderId: string;
      uploadedFiles: number;
      nextAction: string;
    };
    expect(intakeJson.success).toBe(true);
    expect(intakeJson.uploadedFiles).toBe(1);
    expect(intakeJson.tenderId).toBeTruthy();
    expect(["RUN_AI_ANALYZE", "RUN_OCR_OR_REEXTRACT"]).toContain(intakeJson.nextAction);

    const tenderId = intakeJson.tenderId;
    try {
      const additionalUpload = await page.request.post("/api/upload", {
        multipart: {
          tenderId,
          classification: "Tender Addendum",
          file: {
            name: "golden-addendum.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("ADDENDUM: The submission deadline and evaluation criteria remain unchanged. Include a signed acknowledgement of this addendum."),
          },
        },
      });
      expect(additionalUpload.status(), await additionalUpload.text()).toBe(202);
      const uploadJson = await additionalUpload.json() as { success: boolean; uploaded: number; errors: number };
      expect(uploadJson.success).toBe(true);
      expect(uploadJson.uploaded).toBe(1);
      expect(uploadJson.errors).toBe(0);

      const beforeAnalyze = await page.request.get(`/api/tenders/${tenderId}`);
      expect(beforeAnalyze.status(), await beforeAnalyze.text()).toBe(200);
      const beforeJson = await beforeAnalyze.json() as { files: Array<{ id: string; extractedTextLength: number }> };
      expect(beforeJson.files.length).toBe(2);
      expect(beforeJson.files.every((file) => file.id && file.extractedTextLength > 0)).toBe(true);

      const analyze = await page.request.post(`/api/tenders/${tenderId}/ai-analyze?force=true`);
      expect(analyze.status(), await analyze.text()).toBe(200);
      const analyzeJson = await analyze.json() as {
        success: boolean;
        fallback: boolean;
        code: string | null;
        analysisSource: string | null;
        requirementCount: number;
        nextAction: string | null;
        tender: { files: Array<{ id: string; extractedTextLength: number }> } | null;
      };
      expect(analyzeJson.success).toBe(true);
      expect(analyzeJson.fallback).toBe(true);
      expect(analyzeJson.code).toBe("AI_NO_PROVIDER_CONFIGURED");
      expect(analyzeJson.analysisSource).toBe("REGEX_FALLBACK");
      expect(analyzeJson.requirementCount).toBeGreaterThan(0);
      expect(analyzeJson.nextAction).toBe("RETRY_AI_ANALYZE_OR_APPROVE_FALLBACK");
      expect(analyzeJson.tender?.files.length).toBe(2);

      const readiness = await page.request.get(`/api/tenders/${tenderId}/generation-readiness`);
      expect(readiness.status()).toBeLessThan(500);
      const readinessJson = await readiness.json() as { ready?: boolean; blockers?: unknown[] };
      expect(readinessJson.ready).not.toBe(true);
    } finally {
      const cleanup = await page.request.delete(`/api/tenders/${tenderId}`);
      expect([200, 204]).toContain(cleanup.status());
    }
  });
});
