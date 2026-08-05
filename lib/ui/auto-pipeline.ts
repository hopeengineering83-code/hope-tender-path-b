/**
 * Client workflow visibility helpers.
 *
 * Tender upload starts the durable extraction pipeline automatically. The
 * browser may nudge the EXTRACT_TEXT worker for responsiveness — that is the
 * ONLY worker the browser ever nudges.
 *
 * AI Analyze and Run Engine are MANUAL user actions. The browser NEVER nudges
 * the AI_ANALYZE or ENGINE_RUN worker. After extraction completes, the user
 * must click "Run AI Analyze" and then "Run Engine" explicitly. After Run
 * Engine succeeds, matching, generation, validation, document assembly,
 * finalization and Word/PDF/ZIP export continue automatically through durable
 * workers.
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

// AI_ANALYZE_WORKER_ENDPOINT is intentionally NOT exported. The browser must
// never nudge the AI_ANALYZE worker — that is a manual user action triggered
// via POST /api/tenders/:id/manual-ai-analyze. Exporting this constant would
// invite future contributors to re-add automatic AI Analyze continuation.

/**
 * Select the first durable stage that the browser can safely nudge.
 *
 * ONLY EXTRACT_TEXT is auto-nudged. AI_ANALYZE is never auto-nudged — it is
 * a manual user action.
 */
export function decideTenderUploadAutoPipeline(
  response: UploadFirstResponse,
): string | null {
  if (!response.processingJobId) return null;
  if (response.pipelineStage === "EXTRACT_TEXT_QUEUED") {
    return EXTRACT_TEXT_WORKER_ENDPOINT;
  }
  // AI_ANALYZE_QUEUED is intentionally NOT returned — the browser must not
  // nudge AI Analyze. If the server reports AI_ANALYZE_QUEUED (which it
  // should NOT after this redesign), the browser returns null and the user
  // is prompted to click "Run AI Analyze" manually.
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
      source: "tender-upload-extraction",
    });
  }

  const endpoint = decideTenderUploadAutoPipeline(response);
  if (endpoint) {
    const started = await nudgeTenderWorker(endpoint);
    if (started) {
      return {
        fired: true,
        endpoint,
        status: "queued",
        message: "Source extraction started. After extraction completes, click \"Run AI Analyze\" to analyze the tender, then \"Run Engine\" to generate the proposal. After Run Engine, matching, generation, validation, and final export continue automatically.",
      };
    }

    return {
      fired: false,
      endpoint,
      status: "queued",
      message: "Source extraction remains safely queued. The scheduled worker will start it. After extraction completes, click \"Run AI Analyze\".",
    };
  }

  return {
    fired: false,
    endpoint: null,
    status: "skipped",
    message: response.pipelineStage === "AI_ANALYZE_QUEUED"
      ? "Extraction is complete. Click \"Run AI Analyze\" to analyze the tender."
      : response.nextAction
        ? `Upload completed. ${response.nextAction}.`
        : "Upload completed. Source extraction will continue automatically.",
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
