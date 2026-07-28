import { primaryTest as test, expect } from "./auth-helper";
import { waitForDurableTenderExtraction } from "./durable-tender-extraction";
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

  test("upload-first → durable extraction → automatic analysis queue → AI fallback → readiness gate", async ({ page }) => {
    // The storage state is set by the global setup / project config.
    // Navigate directly to the dashboard — no login needed.
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 });

    // upload-first is the only canonical tender-intake endpoint — it accepts
    // multiple files in a single call (form.getAll("file") in
    // lib/tender-upload-first.ts). The addendum file is included here rather
    // than via a second call to the obsolete, nonexistent POST /api/upload
    // route: there is no production endpoint that adds a source file to an
    // already-created tender, so a "second upload" step would either 404
    // against real code or require inventing a fake compatibility endpoint
    // that doesn't exist in production. Testing the real contract means
    // testing what upload-first actually supports.
    // Playwright's `multipart` shorthand only accepts one value per key, so a
    // second file under the same "file" field needs the native FormData API
    // (Node 18+ global) — this still exercises the exact same
    // form.getAll("file") code path in lib/tender-upload-first.ts.
    const form = new FormData();
    form.append("title", "Golden Release Integrity Tender");
    form.append("reference", "RFP-E2E-2026-001");
    form.append("file", new Blob([tenderText], { type: "text/plain" }), "golden-tender.txt");
    form.append(
      "file",
      new Blob(
        ["ADDENDUM: The submission deadline and evaluation criteria remain unchanged. Include a signed acknowledgement of this addendum."],
        { type: "text/plain" },
      ),
      "golden-addendum.txt",
    );
    const intake = await page.request.post("/api/tenders/upload-first", { multipart: form });
    expect(intake.status(), await intake.text()).toBe(201);
    const intakeJson = await intake.json() as {
      success: boolean;
      tenderId: string;
      uploadedFiles: number;
      nextAction: string;
      processingJobId: string | null;
      pipelineStage: string | null;
    };
    expect(intakeJson.success).toBe(true);
    expect(intakeJson.uploadedFiles).toBe(2);
    expect(intakeJson.tenderId).toBeTruthy();
    expect(intakeJson.nextAction).toBe("WAIT_FOR_SOURCE_EXTRACTION");
    expect(intakeJson.processingJobId).toBeTruthy();
    expect(intakeJson.pipelineStage).toBe("EXTRACT_TEXT_QUEUED");

    const tenderId = intakeJson.tenderId;
    try {
      // Upload-first creates the durable, user-owned extraction job before
      // returning. The browser may wake the worker, but it is never the
      // orchestration authority and a lost tab cannot lose the queued work.
      const queuedJob = await page.request.get(`/api/ai-jobs/${intakeJson.processingJobId}`);
      expect(queuedJob.status(), await queuedJob.text()).toBe(200);
      const queuedJobJson = await queuedJob.json() as {
        job: { id: string; tenderId: string; jobType: string; status: string };
      };
      expect(queuedJobJson.job.id).toBe(intakeJson.processingJobId);
      expect(queuedJobJson.job.tenderId).toBe(tenderId);
      expect(queuedJobJson.job.jobType).toBe("EXTRACT_TEXT");
      expect(["QUEUED", "RUNNING"]).toContain(queuedJobJson.job.status);

      const extraction = await waitForDurableTenderExtraction({
        request: page.request,
        tenderId,
        expectedFileCount: 2,
      });
      expect(extraction.files).toHaveLength(2);
      expect(extraction.workerJobIds.length).toBeGreaterThan(0);

      const completedExtraction = await page.request.get(
        `/api/ai-jobs/${extraction.workerJobIds.at(-1)}`,
      );
      expect(completedExtraction.status(), await completedExtraction.text()).toBe(200);
      const completedExtractionJson = await completedExtraction.json() as {
        job: {
          jobType: string;
          status: string;
          output?: { continuation?: { reason?: string | null } | null } | null;
        };
      };
      expect(completedExtractionJson.job.jobType).toBe("EXTRACT_TEXT");
      expect(completedExtractionJson.job.status).toBe("SUCCEEDED");
      expect(completedExtractionJson.job.output?.continuation?.reason).toBe("AI_ANALYZE_QUEUED");

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
      // In CI all provider keys are absent or invalid; any of these codes is valid:
      // "AI_NO_PROVIDER_CONFIGURED"  — no keys configured at all
      // "AI_PROVIDERS_RATE_LIMITED"  — keys present but all in cooldown after attempt
      // "AI_PROVIDERS_EXHAUSTED"     — providers tried and all failed/exhausted
      expect(["AI_NO_PROVIDER_CONFIGURED", "AI_PROVIDERS_RATE_LIMITED", "AI_PROVIDERS_EXHAUSTED"]).toContain(analyzeJson.code);
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
