/**
 * Client workflow visibility helpers.
 *
 * The server owns job creation and continuation. The browser may immediately
 * wake the authenticated worker for a server-created job, but it never creates
 * a second AI_ANALYZE job.
 */

import { emitTenderWorkflowSync } from "./tender-workflow-sync";

export type UploadFirstResponse = {
  success?: boolean;
  tenderId?: string;
  engineSkipped?: boolean;
  nextAction?: string;
  processingJobId?: string;
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

/**
 * Only wake the worker when an upload handler returned the durable job ID it
 * created. A browser response without that proof cannot start anything.
 */
export function decideTenderUploadAutoPipeline(
  response: UploadFirstResponse,
): string | null {
  return response.processingJobId
    ? "/api/ai-jobs/run-next?jobType=AI_ANALYZE"
    : null;
}

/**
 * Wake the user-scoped worker for the durable server-created analysis job.
 * Engine and proposal continuation remain server-owned and fail closed.
 */
export async function triggerTenderUploadAutoPipeline(
  response: UploadFirstResponse,
): Promise<AutoPipelineResult> {
  if (response.tenderId) {
    emitTenderWorkflowSync({
      tenderId: response.tenderId,
      source: "server-owned-tender-upload-pipeline",
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
          message: "Automatic AI analysis started. Later stages remain gated by promoted analysis and readiness checks.",
        };
      }
    } catch {
      // The durable job remains queued. The configured background queue drain
      // is the recovery owner when an immediate browser wake-up is unavailable.
    }
    return {
      fired: false,
      endpoint,
      status: "queued",
      message: "Automatic AI analysis is queued. The background worker will continue it.",
    };
  }

  return {
    fired: false,
    endpoint: null,
    status: "skipped",
    message: response.nextAction
      ? `Upload completed. Continue with the canonical ${response.nextAction} workflow action.`
      : "Upload completed. Open the tender to continue through the canonical workflow.",
  };
}
