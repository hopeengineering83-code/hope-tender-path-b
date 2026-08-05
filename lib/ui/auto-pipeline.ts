/**
 * Client workflow visibility helpers.
 *
 * Tender upload may wake durable source extraction immediately. Later stages
 * are owned by the server-side durable queue, so the browser must not invoke
 * AI Analyze, Run Engine, generation, or finalization directly.
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

/** Upload may nudge extraction; subsequent durable stages continue server-side. */
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
          message: "Source extraction started. The durable workflow will continue automatically through analysis, generation, validation, and package readiness; this page does not need to remain open.",
        };
      }
    } catch {
      // The extraction job remains durable and queued.
    }
    return {
      fired: false,
      endpoint,
      status: "queued",
      message: "Source extraction remains durably queued because the immediate worker start could not be confirmed. The scheduled worker will retry and continue subsequent stages automatically.",
    };
  }

  return {
    fired: false,
    endpoint: null,
    status: "skipped",
    message: response.pipelineStage === "AI_ANALYZE_QUEUED"
      ? "Extraction is complete. AI analysis is durably queued and will continue automatically."
      : response.nextAction
        ? `Upload completed. The durable ${response.nextAction} workflow stage will continue automatically when its prerequisites are satisfied.`
        : "Upload completed. The durable workflow will continue automatically when its prerequisites are satisfied.",
  };
}

export const VAULT_INGEST_WORKER_ENDPOINT = "/api/ai-jobs/run-next?jobType=VAULT_INGEST";

/**
 * Start the VAULT_INGEST job the server has just queued.
 *
 * Queuing and running are separate steps. The durable job is safe to nudge
 * more than once because the worker claim is transactional and tenant-scoped.
 */
export async function startQueuedVaultIngestion(): Promise<void> {
  try {
    const response = await fetch(VAULT_INGEST_WORKER_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
    });
    if (!response.ok) {
      logger.warn("[auto-pipeline] vault ingestion worker nudge was rejected; job stays queued", {
        endpoint: VAULT_INGEST_WORKER_ENDPOINT,
        status: response.status,
      });
    }
  } catch (error) {
    logger.warn("[auto-pipeline] vault ingestion worker nudge failed; job stays queued", {
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      endpoint: VAULT_INGEST_WORKER_ENDPOINT,
    });
  }
}
