/**
 * Client workflow visibility helpers.
 *
 * Tender upload starts the durable pipeline. The browser may nudge the first
 * queued stages for responsiveness, while scheduled workers remain the
 * authoritative fallback. AI Analyze and Run Engine are not required routine
 * user actions.
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

export const EXTRACT_TEXT_WORKER_ENDPOINT = "/api/ai-jobs/run-next?jobType=EXTRACT_TEXT";
export const AI_ANALYZE_WORKER_ENDPOINT = "/api/ai-jobs/run-next?jobType=AI_ANALYZE";

/** Select the first durable stage that the browser can safely nudge. */
export function decideTenderUploadAutoPipeline(
  response: UploadFirstResponse,
): string | null {
  if (!response.processingJobId) return null;
  if (response.pipelineStage === "EXTRACT_TEXT_QUEUED") {
    return EXTRACT_TEXT_WORKER_ENDPOINT;
  }
  if (response.pipelineStage === "AI_ANALYZE_QUEUED") {
    return AI_ANALYZE_WORKER_ENDPOINT;
  }
  return null;
}

async function nudgeTenderWorker(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
    });
    if (!response.ok) {
      logger.warn("[auto-pipeline] tender worker nudge was rejected; durable job stays queued", {
        endpoint,
        status: response.status,
      });
    }
    return response.ok;
  } catch (error) {
    logger.warn("[auto-pipeline] tender worker nudge failed; durable job stays queued", {
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      endpoint,
    });
    return false;
  }
}

export async function triggerTenderUploadAutoPipeline(
  response: UploadFirstResponse,
): Promise<AutoPipelineResult> {
  if (response.tenderId) {
    emitTenderWorkflowSync({
      tenderId: response.tenderId,
      source: "tender-upload-pipeline",
    });
  }

  const endpoint = decideTenderUploadAutoPipeline(response);
  if (endpoint) {
    const started = await nudgeTenderWorker(endpoint);
    if (started) {
      // EXTRACT_TEXT persists the revision-bound AI_ANALYZE continuation before
      // returning. Nudge that next stage without keeping the upload screen
      // blocked; the scheduled worker remains the durable fallback if this
      // best-effort browser request is interrupted.
      if (endpoint === EXTRACT_TEXT_WORKER_ENDPOINT) {
        void nudgeTenderWorker(AI_ANALYZE_WORKER_ENDPOINT);
      }

      return {
        fired: true,
        endpoint,
        status: "queued",
        message: "Automatic tender processing started. Extraction, AI analysis, Engine, generation, validation, and final packaging will continue through durable workers.",
      };
    }

    return {
      fired: false,
      endpoint,
      status: "queued",
      message: "Automatic tender processing remains safely queued. Background workers will continue it; no AI Analyze or Run Engine action is required.",
    };
  }

  return {
    fired: false,
    endpoint: null,
    status: "skipped",
    message: response.pipelineStage === "AI_ANALYZE_QUEUED"
      ? "AI analysis is queued and will continue automatically."
      : response.nextAction
        ? `Upload completed. ${response.nextAction} is queued and will continue automatically.`
        : "Upload completed. Automatic processing will continue in the background.",
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
