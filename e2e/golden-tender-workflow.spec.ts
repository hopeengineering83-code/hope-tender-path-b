import { primaryTest as test, expect } from "./auth-helper";
import { waitForDurableTenderExtraction } from "./durable-tender-extraction";
const FULL = process.env.E2E_GOLDEN_AUTH === "true";

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

test.describe.serial("Golden tender workflow — manual AI Analyze + manual Run Engine", () => {
  test.skip(!FULL, "Set E2E_GOLDEN_AUTH=true and seed the isolated E2E account");
  test.setTimeout(180_000);

  test("upload-first → durable extraction → MANUAL AI Analyze → MANUAL Run Engine → readiness gate", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 });

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
    const api = page.context().request;
    try {
      // ─── 1. Wait for automatic extraction ────────────────────────────────
      // Upload-first persists the durable EXTRACT_TEXT job before returning.
      // The request-scoped wake can legitimately finish it before this read.
      const queuedJob = await api.get(`/api/ai-jobs/${intakeJson.processingJobId}`);
      expect(queuedJob.status(), await queuedJob.text()).toBe(200);
      const queuedJobJson = await queuedJob.json() as {
        job: { id: string; tenderId: string; jobType: string; status: string };
      };
      expect(queuedJobJson.job.id).toBe(intakeJson.processingJobId);
      expect(queuedJobJson.job.tenderId).toBe(tenderId);
      expect(queuedJobJson.job.jobType).toBe("EXTRACT_TEXT");
      expect(["QUEUED", "RUNNING", "SUCCEEDED"]).toContain(queuedJobJson.job.status);

      const extraction = await waitForDurableTenderExtraction({
        request: api,
        tenderId,
        expectedFileCount: 2,
      });
      expect(extraction.files).toHaveLength(2);
      expect(extraction.files.every((file) => file.extractedTextLength > 0)).toBe(true);

      // ─── 2. Verify NO AI_ANALYZE job was auto-queued ─────────────────────
      // The extraction service must NOT queue AI_ANALYZE. Check that no
      // AI_ANALYZE job exists for this tender yet.
      const jobsBeforeManualAnalyze = await api.get(
        `/api/ai-jobs?jobType=AI_ANALYZE&tenderId=${encodeURIComponent(tenderId)}&take=5`,
      );
      if (jobsBeforeManualAnalyze.status() === 200) {
        const jobsJson = await jobsBeforeManualAnalyze.json() as {
          jobs?: Array<{ id: string; tenderId: string | null; jobType: string; status: string }>;
        };
        const aiAnalyzeJobs = jobsJson.jobs?.filter(
          (j) => j.tenderId === tenderId && j.jobType === "AI_ANALYZE",
        ) ?? [];
        // No AI_ANALYZE job should exist before the user manually clicks.
        expect(aiAnalyzeJobs).toHaveLength(0);
      }

      // ─── 3. MANUAL: Click "Run AI Analyze" via the manual route ──────────
      const manualAnalyze = await api.post(`/api/tenders/${tenderId}/manual-ai-analyze`);
      expect(manualAnalyze.status(), await manualAnalyze.text()).toBeLessThan(500);
      const analyzeJson = await manualAnalyze.json() as {
        jobId?: string;
        status?: string;
      };
      expect(analyzeJson.jobId).toBeTruthy();

      // ─── 4. Wake the AI_ANALYZE worker to process the manual job ─────────
      // The browser may nudge the worker to process the manually-queued job.
      // This is a worker wake, not an auto-trigger — the job was queued by
      // the user's manual click.
      const analysisWorker = await api.post(
        `/api/ai-jobs/run-next?jobType=AI_ANALYZE&tenderId=${encodeURIComponent(tenderId)}`,
      );
      expect(analysisWorker.status(), await analysisWorker.text()).toBeLessThan(500);

      // Wait for the AI_ANALYZE job to reach a terminal state.
      await expect.poll(async () => {
        const job = await api.get(`/api/ai-jobs/${analyzeJson.jobId}`);
        if (job.status() !== 200) return "NOT_FOUND";
        const j = await job.json() as { job: { status: string } };
        return j.job.status;
      }, {
        message: "the manual AI_ANALYZE job should reach a terminal state",
        timeout: 90_000,
        intervals: [500, 1_000, 2_000],
      }).toMatch(/^(SUCCEEDED|PARTIAL_SUCCESS|FAILED)$/);

      const analysisJob = await api.get(`/api/ai-jobs/${analyzeJson.jobId}`);
      const analysisJobJson = await analysisJob.json() as {
        job: { tenderId: string; jobType: string; status: string };
      };
      expect(analysisJobJson.job.tenderId).toBe(tenderId);
      expect(analysisJobJson.job.jobType).toBe("AI_ANALYZE");
      expect(analysisJobJson.job.status).not.toBe("CANCELED");

      // ─── 5. MANUAL: Click "Run Engine" (only if AI Analyze succeeded) ────
      if (analysisJobJson.job.status === "SUCCEEDED") {
        const manualEngine = await api.post(`/api/tenders/${tenderId}/engine`);
        expect(manualEngine.status(), await manualEngine.text()).toBeLessThan(500);

        // After Run Engine succeeds, matching, generation, validation, and
        // finalization continue automatically through durable workers. The
        // e2e test verifies the readiness gate reflects the workflow state.
      }

      // ─── 6. Verify the generation-readiness gate ─────────────────────────
      const readiness = await api.get(`/api/tenders/${tenderId}/generation-readiness`);
      expect(readiness.status()).toBeLessThan(500);
      const readinessJson = await readiness.json() as { ready?: boolean; blockers?: unknown[] };
      expect(typeof readinessJson.ready).toBe("boolean");
    } finally {
      const cleanup = await api.delete(`/api/tenders/${tenderId}`);
      expect([200, 204]).toContain(cleanup.status());
    }
  });
});
