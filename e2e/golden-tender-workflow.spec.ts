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

test.describe.serial("Golden tender workflow — authenticated release contract", () => {
  test.skip(!FULL, "Set E2E_GOLDEN_AUTH=true and seed the isolated E2E account");
  test.setTimeout(120_000);

  test("upload-first → durable extraction → automatic AI worker → readiness gate", async ({ page }) => {
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
    try {
      const queuedJob = await page.request.get(`/api/ai-jobs/${intakeJson.processingJobId}`);
      expect(queuedJob.status(), await queuedJob.text()).toBe(200);
      const queuedJobJson = await queuedJob.json() as {
        job: { id: string; tenderId: string; jobType: string; status: string };
      };
      expect(queuedJobJson.job.id).toBe(intakeJson.processingJobId);
      expect(queuedJobJson.job.tenderId).toBe(tenderId);
      expect(queuedJobJson.job.jobType).toBe("EXTRACT_TEXT");
      expect(["QUEUED", "RUNNING", "SUCCEEDED"]).toContain(queuedJobJson.job.status);

      const extraction = await waitForDurableTenderExtraction({
        request: page.request,
        tenderId,
        expectedFileCount: 2,
      });
      expect(extraction.files).toHaveLength(2);
      expect(extraction.files.every((file) => file.extractedTextLength > 0)).toBe(true);

      let continuationAnalysisJobId: string | null = null;
      for (const extractionJobId of extraction.workerJobIds) {
        const completedExtraction = await page.request.get(`/api/ai-jobs/${extractionJobId}`);
        expect(completedExtraction.status(), await completedExtraction.text()).toBe(200);
        const completedExtractionJson = await completedExtraction.json() as {
          job: {
            jobType: string;
            status: string;
            output?: {
              continuation?: {
                reason?: string | null;
                jobId?: string | null;
              } | null;
            } | null;
          };
        };
        expect(completedExtractionJson.job.jobType).toBe("EXTRACT_TEXT");
        expect(completedExtractionJson.job.status).toBe("SUCCEEDED");
        if (completedExtractionJson.job.output?.continuation?.reason === "AI_ANALYZE_QUEUED") {
          continuationAnalysisJobId = completedExtractionJson.job.output.continuation.jobId ?? null;
        }
      }

      // The browser never calls the manual Analyze endpoint. The analysis job
      // must already exist for this exact tender before the queue is woken.
      const findAnalysisJobId = async (): Promise<string | null> => {
        const jobsResponse = await page.request.get(
          `/api/ai-jobs?jobType=AI_ANALYZE&tenderId=${encodeURIComponent(tenderId)}&take=5`,
        );
        if (jobsResponse.status() !== 200) return null;
        const jobsJson = await jobsResponse.json() as {
          jobs?: Array<{ id: string; tenderId: string | null; jobType: string; status: string }>;
        };
        const exactJob = jobsJson.jobs?.find((job) =>
          job.tenderId === tenderId && job.jobType === "AI_ANALYZE"
        );
        return exactJob?.id ?? null;
      };

      await expect.poll(findAnalysisJobId, {
        message: "extraction should persist an automatic AI_ANALYZE job for this tender",
        timeout: 15_000,
        intervals: [100, 250, 500],
      }).toBeTruthy();

      const analysisJobId = await findAnalysisJobId();
      if (!analysisJobId) throw new Error("Automatic AI_ANALYZE job was not persisted");
      if (continuationAnalysisJobId) {
        expect(analysisJobId).toBe(continuationAnalysisJobId);
      }

      // Wake only this tender's durable job. If the request-scoped or scheduled
      // worker won the race, a queue-empty response is valid and the exact job
      // below must already be RUNNING or terminal.
      const analysisWorker = await page.request.post(
        `/api/ai-jobs/run-next?jobType=AI_ANALYZE&tenderId=${encodeURIComponent(tenderId)}`,
      );
      expect(analysisWorker.status(), await analysisWorker.text()).toBeLessThan(500);
      const analysisWorkerJson = await analysisWorker.json() as {
        processed?: boolean;
        jobId?: string | null;
        jobType?: string | null;
        terminalStatus?: string | null;
        resultCode?: string | null;
      };
      if (analysisWorkerJson.processed) {
        expect(analysisWorkerJson.jobId).toBe(analysisJobId);
        expect(analysisWorkerJson.jobType).toBe("AI_ANALYZE");
        expect(["SUCCEEDED", "PARTIAL_SUCCESS", "FAILED"]).toContain(analysisWorkerJson.terminalStatus);
        expect(analysisWorkerJson.resultCode).toBeTruthy();
      }

      type AnalysisJobResponse = {
        job: {
          tenderId: string;
          jobType: string;
          status: string;
        };
      };
      const fetchAnalysisJob = async (): Promise<AnalysisJobResponse | null> => {
        const analysisJob = await page.request.get(`/api/ai-jobs/${analysisJobId}`);
        if (analysisJob.status() !== 200) return null;
        return await analysisJob.json() as AnalysisJobResponse;
      };
      await expect.poll(async () => {
        const exactJob = await fetchAnalysisJob();
        return exactJob?.job.status ?? "NOT_FOUND";
      }, {
        message: "the exact automatic AI_ANALYZE job should reach a terminal state",
        timeout: 60_000,
        intervals: [100, 250, 500, 1_000],
      }).toMatch(/^(SUCCEEDED|PARTIAL_SUCCESS|FAILED)$/);

      const analysisJobJson = await fetchAnalysisJob();
      if (!analysisJobJson) throw new Error("Automatic AI_ANALYZE job status was unavailable");
      expect(analysisJobJson.job.tenderId).toBe(tenderId);
      expect(analysisJobJson.job.jobType).toBe("AI_ANALYZE");
      expect(analysisJobJson.job.status).not.toBe("CANCELED");

      const readiness = await page.request.get(`/api/tenders/${tenderId}/generation-readiness`);
      expect(readiness.status()).toBeLessThan(500);
      const readinessJson = await readiness.json() as { ready?: boolean; blockers?: unknown[] };
      expect(typeof readinessJson.ready).toBe("boolean");
    } finally {
      const cleanup = await page.request.delete(`/api/tenders/${tenderId}`);
      expect([200, 204]).toContain(cleanup.status());
    }
  });
});
