/**
 * Client workflow visibility helpers.
 *
 * Tender upload may wake durable source extraction immediately. AI Analyze and
 * Run Engine are the only two normal user actions, so this helper must never
 * wake either stage from an upload response.
 */

import { emitTenderWorkflowSync } from "./tender-workflow-sync";
import { logger } from "../observability";

export type UploadFirstResponse = {
  success?: boolean;
  tenderId?: string;
  engineSkipped?: boolean;
  nextAction?: string;
  processingJobId?: string;
  pipelineStage?: "EXTRACT_TEXT_QUEUED" | "AI_ANALYZE_QUEUED" | null;
  error?: string;
  code?: string;
  requestId?: string;
};

export type AutoPipelineResult = {
  fired: boolean;
  endpoint: string | null;
  status: "queued" | "skipped" | "failed";
  message: string;
};

/** Upload may wake extraction, but never AI Analyze or Run Engine. */
export function decideTenderUploadAutoPipeline(
  response: UploadFirstResponse,
): string | null {
  if (!response.processingJobId) return null;
  return response.pipelineStage === "EXTRACT_TEXT_QUEUED"
    ? "/api/ai-jobs/run-next?jobType=EXTRACT_TEXT"
    : null;
}

export async function triggerTenderUploadAutoPipeline(
  response: UploadFirstResponse,
): Promise<AutoPipelineResult> {
  if (response.tenderId) {
    emitTenderWorkflowSync({
      tenderId: response.tenderId,
      source: "tender-upload-extraction",
    });
  }

  const endpoint = decideTenderUploadAutoPipeline(response);
  if (endpoint) {
    try {
      const worker = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
      });
      if (worker.ok) {
        return {
          fired: true,
          endpoint,
          status: "queued",
          message: "Source extraction started. Open the tender and use AI Analyze after extraction completes.",
        };
      }
    } catch {
      // The extraction job remains durable and queued.
    }
    return {
      fired: false,
      endpoint,
      status: "queued",
      message: "Source extraction is queued. The background worker will continue it; AI Analyze remains an explicit action.",
    };
  }

  return {
    fired: false,
    endpoint: null,
    status: "skipped",
    message: response.pipelineStage === "AI_ANALYZE_QUEUED"
      ? "Extraction is complete. Open the tender and select AI Analyze."
      : response.nextAction
        ? `Upload completed. Continue with the canonical ${response.nextAction} workflow action.`
        : "Upload completed. Open the tender to continue.",
  };
}

export const VAULT_INGEST_WORKER_ENDPOINT = "/api/ai-jobs/run-next?jobType=VAULT_INGEST";

/**
 * Start the VAULT_INGEST job the server has just queued.
 *
 * Queuing and running are separate steps. Uploading a Company Vault document
 * enqueues VAULT_INGEST (lib/secure-upload-handler.ts) and the UI reports
 * "queued — this completes automatically", but nothing in that path ever
 * claimed the job: the two manual repair controls woke the worker inline while
 * the upload path, the one on the owner's normal route, did not. The only
 * other claimant is .github/workflows/drain-ai-job-queue.yml, which posts to
 * the PRODUCTION host — so on a preview deployment the job had no runner at
 * all and sat QUEUED indefinitely.
 *
 * The visible result was a vault of documents with no extracted text and
 * integrityStatus still at its "UNKNOWN" default, which makes
 * sourceByteIntegrityIsVerified() false, which leaves every Expert and Project
 * record unable to cite a source, which blocks the final ZIP. One unstarted
 * job, the whole pipeline stalled.
 *
 * Waking the worker is best-effort by design: the job is durable, so a failed
 * nudge costs latency, never work. That is why this never throws and never
 * reports failure — there is nothing for a caller to handle.
 */
export async function startQueuedVaultIngestion(): Promise<void> {
  try {
    await fetch(VAULT_INGEST_WORKER_ENDPOINT, { method: "POST", credentials: "same-origin" });
  } catch (error) {
    logger.warn("[auto-pipeline] vault ingestion worker nudge failed; job stays queued", {
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      endpoint: VAULT_INGEST_WORKER_ENDPOINT,
    });
  }
}
